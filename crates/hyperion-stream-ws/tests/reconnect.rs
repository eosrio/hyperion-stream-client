mod support;
use futures_util::StreamExt;
use hyperion_stream_core::{Delivery, Event};
use hyperion_stream_ws::{ActionRequest, Options, Request, WsClient};
use std::time::Duration;
use support::*;
use tokio::net::TcpListener;

#[tokio::test]
async fn reconnect_uses_fresh_request_deadline_after_time_offline() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut first = accept(&listener, "1").await;
        let sub = read(&mut first).await;
        send(&mut first, accepted(&sub, "1")).await;
        let mut second = accept(&listener, "2").await;
        let sub = read(&mut second).await;
        assert_eq!(sub["generation"], "2");
        send(&mut second, accepted(&sub, "2")).await;
        let _ = second.next().await;
    });
    let mut options = Options::default();
    options.core.request_timeout_ms = 100;
    let mut client = WsClient::connect(&format!("ws://{address}/stream/v2"), options)
        .await
        .unwrap();
    client
        .subscribe(
            1,
            Request::Action(ActionRequest::default()),
            Delivery::Head,
            true,
        )
        .await
        .unwrap();
    assert!(matches!(
        client.next_event().await.unwrap(),
        Event::Connected(_)
    ));
    assert!(matches!(
        client.next_event().await.unwrap(),
        Event::Accepted { .. }
    ));
    tokio::time::sleep(Duration::from_millis(200)).await;
    client.reconnect().await.unwrap();
    assert!(matches!(
        client.next_event().await.unwrap(),
        Event::Connected(_)
    ));
    let result = client.next_event().await.unwrap();
    assert!(matches!(result, Event::Accepted { .. }), "{result:?}");
    drop(client);
    server.await.unwrap();
}

#[tokio::test]
async fn explicit_reconnect_retains_required_error_for_replay_disabled_stream() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut first = accept(&listener, "1").await;
        let sub = read(&mut first).await;
        send(&mut first, accepted(&sub, "1")).await;
        let mut second = accept(&listener, "2").await;
        let _ = second.next().await;
    });
    let mut client = WsClient::connect(&format!("ws://{address}/stream/v2"), Options::default())
        .await
        .unwrap();
    client
        .subscribe(
            1,
            Request::Action(ActionRequest::default()),
            Delivery::Head,
            false,
        )
        .await
        .unwrap();
    client.next_event().await.unwrap();
    client.next_event().await.unwrap();
    client.reconnect().await.unwrap();
    let outcome = client.next_event().await.unwrap();
    assert!(
        matches!(outcome,Event::Error(ref e) if e.code=="STREAM_REPLAY_REQUIRED" && e.retryable),
        "{outcome:?}"
    );
    assert!(matches!(
        client.next_event().await.unwrap(),
        Event::Connected(_)
    ));
    drop(client);
    server.await.unwrap();
}

#[tokio::test]
async fn repeated_local_cancellation_has_a_bounded_control_outcome_queue() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut ws = accept(&listener, "1").await;
        while let Some(Ok(_)) = ws.next().await {}
    });
    let mut client = WsClient::connect(&format!("ws://{address}/stream/v2"), Options::default())
        .await
        .unwrap();
    let mut bounded_failure = None;
    for _ in 0..256 {
        match client
            .subscribe(
                1,
                Request::Action(ActionRequest::default()),
                Delivery::Head,
                true,
            )
            .await
        {
            Ok(()) => {}
            Err(e) => {
                bounded_failure = Some(e);
                break;
            }
        }
        if let Err(e) = client.cancel(1).await {
            bounded_failure = Some(e);
            break;
        }
    }
    assert_eq!(
        bounded_failure.map(|e| e.code).as_deref(),
        Some("EVENT_QUEUE_OVERFLOW")
    );
    drop(client);
    server.await.unwrap();
}

#[tokio::test]
async fn failed_reconnect_cannot_reuse_disconnect_reserve_without_draining_events() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut connection = 0;
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            connection += 1;
            let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(tcp, negotiate).await else {
                continue;
            };
            send(&mut ws,serde_json::json!({"type":"hello","version":1,"connection_id":connection.to_string(),"chain_id":"a".repeat(64),"heartbeat_interval_ms":15000})).await;
            while let Some(Ok(_)) = ws.next().await {}
        }
    });
    let mut options = Options::default();
    options.core.max_streams = 1;
    options.max_pending_events = 3;
    let mut client = WsClient::connect(&format!("ws://{address}"), options)
        .await
        .unwrap();
    client.next_event().await.unwrap();
    let mut admission_failed = false;
    for _ in 0..10 {
        if let Err(error) = client
            .subscribe(
                1,
                Request::Action(ActionRequest::default()),
                Delivery::Head,
                false,
            )
            .await
        {
            assert_eq!(error.code, "EVENT_QUEUE_OVERFLOW");
            admission_failed = true;
            break;
        }
        let _ = client.reconnect().await;
    }
    let mut outcomes = 0;
    while let Ok(Ok(_)) = tokio::time::timeout(Duration::from_millis(20), client.next_event()).await
    {
        outcomes += 1;
    }
    drop(client);
    server.abort();
    let _ = server.await;
    assert!(
        admission_failed,
        "Offline subscription must honor undrained event capacity"
    );
    assert!(
        outcomes <= 5,
        "normal cap plus at most one active stream/disconnect reserve: {outcomes}"
    );
}

#[tokio::test]
async fn simultaneous_terminal_errors_survive_normal_event_budget_overflow() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut connection = 0;
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            connection += 1;
            let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(tcp, negotiate).await else {
                continue;
            };
            send(&mut ws,serde_json::json!({"type":"hello","version":1,"connection_id":connection.to_string(),"chain_id":"a".repeat(64),"heartbeat_interval_ms":15000})).await;
            while let Some(Ok(_)) = ws.next().await {}
        }
    });
    let mut options = Options::default();
    options.core.max_streams = 2;
    options.max_pending_events = 4;
    options.core.request_timeout_ms = 20;
    let mut client = WsClient::connect(&format!("ws://{address}"), options)
        .await
        .unwrap();
    client.next_event().await.unwrap();
    for _ in 0..2 {
        client
            .subscribe(
                1,
                Request::Action(ActionRequest::default()),
                Delivery::Head,
                false,
            )
            .await
            .unwrap();
        client.reconnect().await.unwrap();
    }
    for id in 1..=2 {
        client
            .subscribe(
                id,
                Request::Action(ActionRequest::default()),
                Delivery::Head,
                false,
            )
            .await
            .unwrap();
    }
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(
        client.next_event().await.unwrap_err().code,
        "EVENT_QUEUE_OVERFLOW"
    );
    let mut codes = Vec::new();
    while let Ok(Ok(event)) =
        tokio::time::timeout(Duration::from_millis(20), client.next_event()).await
    {
        if let Event::Error(error) = event {
            codes.push(error.code);
        }
    }
    drop(client);
    server.abort();
    let _ = server.await;
    assert_eq!(
        codes,
        vec![
            "STREAM_REPLAY_REQUIRED",
            "STREAM_REPLAY_REQUIRED",
            "REQUEST_TIMEOUT",
            "REQUEST_TIMEOUT"
        ]
    );
}

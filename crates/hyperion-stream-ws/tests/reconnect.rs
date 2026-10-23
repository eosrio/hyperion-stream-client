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

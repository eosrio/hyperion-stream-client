mod support;
use futures_util::{SinkExt, StreamExt};
use hyperion_stream_core::{Delivery, Event};
use hyperion_stream_ws::{ActionRequest, Options, Request, WsClient};
use serde_json::json;
use std::time::Duration;
use support::*;
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};

#[tokio::test]
async fn wrong_subprotocol_is_rejected_before_subscribing() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let _ = accept_async(tcp).await;
    });
    assert!(
        WsClient::connect(&format!("ws://{address}"), Options::default())
            .await
            .is_err()
    );
    server.await.unwrap();
}

#[tokio::test]
#[allow(
    clippy::result_large_err,
    reason = "Tungstenite requires this external callback error type"
)]
async fn authentication_rejection_is_not_a_retryable_transport_failure() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let _ = tokio_tungstenite::accept_hdr_async(
            tcp,
            |_: &tokio_tungstenite::tungstenite::handshake::server::Request, _| {
                Err(tokio_tungstenite::tungstenite::http::Response::builder()
                    .status(401)
                    .body(Some("authentication required".into()))
                    .unwrap())
            },
        )
        .await;
    });
    let error = WsClient::connect(&format!("ws://{address}"), Options::default())
        .await
        .err()
        .unwrap();
    assert_eq!(error.code, "HTTP_ERROR");
    assert!(!error.retryable);
    server.await.unwrap();
}

#[tokio::test]
async fn malformed_json_binary_and_oversize_messages_fail_boundedly() {
    for message in [
        Message::text("{bad"),
        Message::binary(vec![1, 2, 3]),
        Message::text("x".repeat(2048)),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut ws = accept(&listener, "1").await;
            let _ = ws.send(message).await;
            let _ = ws.next().await;
        });
        let options = Options {
            max_message_bytes: 1024,
            ..Options::default()
        };
        let mut client = WsClient::connect(&format!("ws://{address}"), options)
            .await
            .unwrap();
        client.next_event().await.unwrap();
        let failure = tokio::time::timeout(Duration::from_secs(1), client.next_event())
            .await
            .unwrap()
            .unwrap_err();
        assert!(!failure.message.is_empty());
        assert!(!client.is_connected());
        drop(client);
        server.await.unwrap();
    }
}

#[tokio::test]
async fn idle_peer_has_a_finite_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut ws = accept(&listener, "1").await;
        let _ = ws.next().await;
    });
    let options = Options {
        idle_timeout: Duration::from_millis(20),
        ..Options::default()
    };
    let mut client = WsClient::connect(&format!("ws://{address}"), options)
        .await
        .unwrap();
    client.next_event().await.unwrap();
    let error = tokio::time::timeout(Duration::from_secs(1), client.next_event())
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code, "IDLE_TIMEOUT");
    assert!(error.retryable);
    drop(client);
    server.await.unwrap();
}

#[tokio::test]
async fn cancelling_a_pending_read_does_not_cancel_or_lose_the_subscription() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (release, wait) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let mut ws = accept(&listener, "1").await;
        let sub = read(&mut ws).await;
        wait.await.unwrap();
        send(&mut ws, accepted(&sub, "1")).await;
        let _ = ws.next().await;
    });
    let mut client = WsClient::connect(&format!("ws://{address}"), Options::default())
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
    client.next_event().await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(10), client.next_event())
            .await
            .is_err()
    );
    release.send(()).unwrap();
    assert!(matches!(
        client.next_event().await.unwrap(),
        Event::Accepted { .. }
    ));
    drop(client);
    server.await.unwrap();
}

#[tokio::test]
async fn transport_drop_during_finality_wait_replays_only_new_connection_payloads() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut first = accept(&listener, "1").await;
        let sub = read(&mut first).await;
        send(&mut first, accepted(&sub, "1")).await;
        let mut frame = json!({"type":"data","connection_id":"1","stream_id":"1","generation":"1","subscription_id":"100","sequence":"1","mode":"history","records":[{"block_num":100,"block_id":"b".repeat(64),"payload":{"fork":"old"}}]});
        send(&mut first, frame.clone()).await;
        drop(first);
        let mut second = accept(&listener, "2").await;
        let sub = read(&mut second).await;
        assert_eq!(sub["resume_from"], 100);
        assert_eq!(sub["generation"], "2");
        send(&mut second, accepted(&sub, "2")).await;
        send(&mut second,json!({"type":"lib","connection_id":"2","chain_id":"a".repeat(64),"block_num":200,"block_id":"c".repeat(64)})).await;
        frame["connection_id"] = json!("2");
        frame["generation"] = json!("2");
        frame["records"][0]["payload"] = json!({"fork":"new"});
        send(&mut second, frame).await;
        let _ = second.next().await;
    });
    let mut client = WsClient::connect(&format!("ws://{address}"), Options::default())
        .await
        .unwrap();
    client
        .subscribe(
            1,
            Request::Action(ActionRequest::default()),
            Delivery::Irreversible,
            true,
        )
        .await
        .unwrap();
    client.next_event().await.unwrap();
    client.next_event().await.unwrap();
    assert!(client.next_event().await.is_err());
    client.reconnect().await.unwrap();
    for _ in 0..3 {
        assert!(!matches!(
            client.next_event().await.unwrap(),
            Event::Data(_)
        ));
    }
    let Event::Data(batch) = client.next_event().await.unwrap() else {
        panic!("new data")
    };
    assert_eq!(batch.records[0].payload, json!({"fork":"new"}));
    drop(client);
    server.await.unwrap();
}

mod support;
use futures_util::StreamExt;
use hyperion_stream_core::{Delivery, Event};
use hyperion_stream_ws::{Options, Request, WsClient};
use serde_json::{json, Value};
use support::*;
use tokio::net::TcpListener;

fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../../conformance/v1/network-sessions.json"
    ))
    .unwrap()
}

async fn serve(listener: TcpListener, fixture: Value) {
    let mut ws = accept(&listener, "1").await;
    let sub = read(&mut ws).await;
    assert_eq!(sub["request"], fixture["request"]);
    assert_eq!(sub["generation"], "1");
    for frame in fixture["server_frames"].as_array().unwrap() {
        send(&mut ws, frame.clone()).await;
    }
    let mut acks = Vec::new();
    let mut pong = false;
    while acks.len() < 2 || !pong {
        let received = read(&mut ws).await;
        match received["type"].as_str().unwrap() {
            "ack" => {
                assert_eq!(received["connection_id"], "1");
                assert_eq!(received["generation"], "1");
                assert_eq!(received["subscription_id"], "100");
                acks.push(received["sequence"].clone());
            }
            "pong" => {
                assert_eq!(received["id"], "18446744073709551615");
                pong = true;
            }
            other => panic!("Unexpected {other}"),
        }
    }
    assert_eq!(json!(acks), fixture["expected_acks"]);
    let _ = ws.close(None).await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(1), ws.next()).await;
}

#[tokio::test]
async fn rust_adapter_runs_shared_action_and_delta_network_sessions() {
    for fixture in corpus()["cases"].as_array().unwrap() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(serve(listener, fixture.clone()));
        let mut client =
            WsClient::connect(&format!("ws://{address}/stream/v2"), Options::default())
                .await
                .unwrap();
        let request: Request = serde_json::from_value(fixture["request"].clone()).unwrap();
        client
            .subscribe(1, request, Delivery::Head, true)
            .await
            .unwrap();
        let mut records = Vec::new();
        loop {
            match client.next_event().await.unwrap() {
                Event::Data(batch) => {
                    for record in batch.records {
                        records.push(json!({"block_num":record.block_num,"block_id":record.block_id,"cursor":record.cursor.map(|n|n.to_string()),"payload":record.payload}));
                    }
                }
                Event::End { .. } => break,
                Event::Error(e) => panic!("{e}"),
                _ => {}
            }
        }
        assert_eq!(json!(records), fixture["expected_records"]);
        drop(client);
        server.await.unwrap();
    }
}

#[tokio::test]
async fn native_javascript_peer_runs_the_same_action_and_delta_network_sessions() {
    for (index, fixture) in corpus()["cases"].as_array().unwrap().iter().enumerate() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(serve(listener, fixture.clone()));
        let output = tokio::task::spawn_blocking(move || {
            std::process::Command::new(
                std::env::var_os("HYPERION_NODE").unwrap_or_else(|| "node".into()),
            )
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../conformance/v1/node-peer.mjs"
            ))
            .arg(format!("ws://{address}/stream/v2"))
            .arg(index.to_string())
            .output()
            .unwrap()
        })
        .await
        .unwrap();
        assert!(
            output.status.success(),
            "status={:?} stdout={} stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(result["records"], fixture["expected_records"]);
        server.await.unwrap();
    }
}

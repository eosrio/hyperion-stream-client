use futures_util::{SinkExt, StreamExt};
use hyperion_stream_core::{Delivery, Event, PROTOCOL};
use hyperion_stream_ws::{ActionRequest, Options, Request, WsClient};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{Request as HandshakeRequest, Response},
        Message,
    },
};

#[tokio::test]
async fn actual_websocket_delivers_json_and_acknowledges_after_application_acceptance() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut ws = accept_hdr_async(tcp, |req: &HandshakeRequest, mut response: Response| {
            assert_eq!(req.headers()["sec-websocket-protocol"], PROTOCOL);
            response
                .headers_mut()
                .insert("sec-websocket-protocol", PROTOCOL.parse().unwrap());
            Ok(response)
        })
        .await
        .unwrap();
        ws.send(Message::text(json!({"type":"hello","version":1,"connection_id":"1","chain_id":"a".repeat(64),"heartbeat_interval_ms":15000}).to_string())).await.unwrap();
        let ready: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(ready["type"], "ready");
        let sub: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(sub["request"]["kind"], "action");
        let mut scope =
            json!({"connection_id":"1","stream_id":"1","generation":"1","subscription_id":"100"});
        scope["type"] = json!("accepted");
        scope["request_id"] = json!("1");
        scope["start_from"] = json!(100);
        ws.send(Message::text(scope.to_string())).await.unwrap();
        scope.as_object_mut().unwrap().remove("request_id");
        scope.as_object_mut().unwrap().remove("start_from");
        scope["type"] = json!("data");
        scope["sequence"] = json!("1");
        scope["mode"] = json!("history");
        scope["records"] = json!([{"block_num":100,"block_id":"b".repeat(64),"cursor":"18446744073709551615","payload":{"global_sequence":"18446744073709551615"}}]);
        ws.send(Message::text(scope.to_string())).await.unwrap();
        let ack: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(
            ack,
            json!({"type":"ack","connection_id":"1","stream_id":"1","generation":"1","subscription_id":"100","sequence":"1"})
        );
        let cancel: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(cancel["type"], "cancel");
    });
    let mut client = WsClient::connect(&format!("ws://{address}/stream/v2"), Options::default())
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
    let Event::Data(data) = client.next_event().await.unwrap() else {
        panic!("data");
    };
    assert_eq!(data.records[0].cursor, Some(u64::MAX));
    client.cancel(1).await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap();
}

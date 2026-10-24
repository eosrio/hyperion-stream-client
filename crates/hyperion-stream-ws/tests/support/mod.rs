use futures_util::{SinkExt, StreamExt};
use hyperion_stream_core::PROTOCOL;
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{ErrorResponse, Request, Response},
        Message,
    },
    WebSocketStream,
};

#[allow(
    clippy::result_large_err,
    reason = "Tungstenite requires this external callback error type"
)]
pub fn negotiate(request: &Request, mut response: Response) -> Result<Response, ErrorResponse> {
    assert_eq!(request.headers()["sec-websocket-protocol"], PROTOCOL);
    response
        .headers_mut()
        .insert("sec-websocket-protocol", PROTOCOL.parse().unwrap());
    Ok(response)
}

#[allow(
    dead_code,
    reason = "Shared test module; TLS scenarios accept their own encrypted stream"
)]
pub async fn accept(listener: &TcpListener, connection: &str) -> WebSocketStream<TcpStream> {
    let (tcp, _) = listener.accept().await.unwrap();
    let mut ws = accept_hdr_async(tcp, negotiate).await.unwrap();
    send(&mut ws, json!({"type":"hello","version":1,"connection_id":connection,"chain_id":"a".repeat(64),"heartbeat_interval_ms":15000})).await;
    assert_eq!(read(&mut ws).await["type"], "ready");
    ws
}

pub async fn read<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(
    ws: &mut WebSocketStream<T>,
) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            match ws.next().await.unwrap().unwrap() {
                Message::Text(text) => {
                    let packet: Value = serde_json::from_str(&text).unwrap();
                    if packet["type"] == "ping" {
                        send(ws, json!({"type":"pong","id":packet["id"]})).await;
                        continue;
                    }
                    return packet;
                }
                Message::Ping(_) => ws.flush().await.unwrap(),
                _ => panic!("Expected text"),
            }
        }
    })
    .await
    .expect("fixture read deadline")
}

pub async fn send<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(
    ws: &mut WebSocketStream<T>,
    packet: Value,
) {
    ws.send(Message::text(packet.to_string())).await.unwrap();
}

#[allow(
    dead_code,
    reason = "Shared test module; only reconnect scenarios need this helper"
)]
pub fn accepted(subscribe: &Value, connection: &str) -> Value {
    json!({"type":"accepted","connection_id":connection,"stream_id":subscribe["stream_id"],"generation":subscribe["generation"],"request_id":subscribe["request_id"],"subscription_id":"100","start_from":100})
}

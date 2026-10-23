# hyperion-stream-ws

Experimental Rust client for Hyperion's proposed additive native WebSocket + JSON
endpoint. Requires a compatible native server; the legacy Socket.IO `/stream`
endpoint uses a different protocol. Server integration is tracked in HAPI #294.

This adapter explicitly depends on Tokio, tokio-tungstenite, Serde/JSON and Rustls.
The separate `hyperion-stream-core` crate has no third-party dependencies. Default
TLS selects Ring explicitly, uses Mozilla roots, and verifies certificates and
hostnames. Supply `Options::tls` for private CA roots/client certificates and
`Options::headers` for authentication/Origin headers. No TLS verification bypass
is provided by the client.

```rust,no_run
use hyperion_stream_ws::{WsClient, Options, Request, ActionRequest};
use hyperion_stream_ws::core::{Delivery, Event};

# async fn example() -> Result<(), Box<dyn std::error::Error>> {
let mut client = WsClient::connect("wss://example.org/stream/v2", Options::default()).await?;
client.subscribe(1, Request::Action(ActionRequest {
    contract: Some("eosio.token".into()),
    action: Some("transfer".into()),
    ..ActionRequest::default()
}), Delivery::Irreversible, true).await?;
loop {
    match client.next_event().await? {
        Event::Data(batch) => println!("{:?}", batch.records),
        Event::Error(error) => return Err(error.into()),
        Event::End { .. } => break,
        _ => {}
    }
}
client.cancel(1).await?;
# Ok(())
# }
```

The client is single-owner and pull-driven: `next_event` drives reads, heartbeat
and deadlines. For long application work, poll it in an application-owned task
and pass batches through a bounded channel. No detached tasks survive drop. A
pending read can be cancelled and polled again. If an I/O-producing operation
(subscribe/cancel/reconnect/ACK write) is interrupted, its network outcome may be
ambiguous; reconnect explicitly before continuing that connection.

The adapter returns one batch at a time; its acceptance ACK is flushed on the next
drive call, after the caller received it. Callers retain their own durable
checkpoint and deduplicate inclusive replay. `cancel` stops local delivery first;
success does not claim the remote cleanup acknowledgement has arrived. `reconnect`
is explicit and bounded, retains terminal stream errors, and refreshes acceptance
deadlines after network downtime. There is no infinite automatic retry policy.

Defaults: 1 MiB message cap, 5s connect/write deadlines, 45s idle deadline, 64 pending
public events plus a fixed disconnect-outcome reserve. Core defaults: 16 streams,
1024 records/2 MiB per stream, 4096 records/8 MiB per connection, 10s acceptance and
60s irreversible-progress deadlines. Overflow fails visibly; data/control state
does not grow without a bound. Processing-time/real source/proxy/fanout acceptance
and release publication remain separate qualifications.

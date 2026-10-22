# Rust-first streaming without Socket.IO: transport research

Research date: 2026-10-22. This is an implementation proposal, not an accepted protocol or
release qualification. No runtime, dependencies, release pins, or running services were changed.

## Recommendation

Use standard WebSocket with a small, versioned Hyperion application protocol for the new
Rust-first client. Retain the existing Socket.IO route during migration and run both routes
against the same behavioral conformance suite. JavaScript and later Python clients can use
their own native WebSocket implementations; neither needs to load a Rust shared library.
This recommendation is an architectural inference from the sources below, not a measured
throughput or memory result. The API/relay integration scope needs the separate source audit.
Accepted dependency policy: the user permits a **zero-dependency core with a separate
transport/TLS adapter**. Keep third-party runtime, TLS, codec and ecosystem types out of the
core's required dependency graph and public interface. Adapter dependencies remain explicit.

## Options

| Option | Verified properties | Assessment |
| --- | --- | --- |
| Standard WebSocket | RFC 6455 defines bidirectional text/binary messages, control frames, closing, an opening handshake, and subprotocol selection. | Best fit for subscription commands, data, cancellation, and acknowledgements on one connection. Hyperion must define application semantics. |
| Keep the Socket.IO wire protocol but remove its library | Engine.IO defines connection establishment, heartbeat and packet encoding; Socket.IO adds namespace/event/ACK and binary-attachment framing. | Preserves endpoint compatibility but leaves us maintaining those protocols. It removes the package, not the protocol dependency. |
| SSE plus HTTP control requests | EventSource receives UTF-8 event streams, reconnects, and sends `Last-Event-ID`; its interface is receive-oriented. | Feasible, but subscribe/cancel/ACK traffic needs additional HTTP requests and correlation. Binary payloads need an application encoding. It is less direct for this bidirectional workload. |
| gRPC streaming | Native gRPC supports streaming flow control. The official grpc-web implementation currently supports unary and server streaming, but not client or bidirectional streaming. | Attractive for a native-only interface; browser parity requires another pattern or transport. Not the first common transport. |

Sources: [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455.html),
[Engine.IO protocol](https://socket.io/docs/v4/engine-io-protocol/),
[Socket.IO protocol](https://socket.io/docs/v4/socket-io-protocol/),
[EventSource specification](https://html.spec.whatwg.org/multipage/server-sent-events.html),
[gRPC flow control](https://grpc.io/docs/guides/flow-control/),
[grpc-web streaming support](https://github.com/grpc/grpc-web#streaming-support).
Socket.IO protocol revision numbers and package major versions are distinct; interoperability
must pin the actual wire revision rather than guessing from a library's version label.

## Rust, Node and browser feasibility

Recommended optional native adapter: **Tokio + tokio-tungstenite + Rustls**. Tokio supplies
scheduling/network I/O; Tungstenite implements WebSocket; tokio-tungstenite integrates it
with Tokio. These are explicit adapter dependencies, not dependencies of the core.

| Crate | Current stable reference, 2026-10-22 | Role |
| --- | --- | --- |
| Tokio | 1.54.1 | Async runtime, network I/O, timers and synchronization. |
| tokio-tungstenite / Tungstenite | 0.30.0 / 0.30.0 | Async adapter / RFC 6455 implementation. |
| Rustls | 0.23.46 | TLS, with explicit crypto-provider and trust-root configuration. |
| fastwebsockets | 0.10.0 | Alternate frame-oriented implementation to benchmark. |

Versions were checked against the [Tokio](https://crates.io/api/v1/crates/tokio),
[tokio-tungstenite](https://crates.io/api/v1/crates/tokio-tungstenite),
[Tungstenite](https://crates.io/api/v1/crates/tungstenite),
[Rustls](https://crates.io/api/v1/crates/rustls) and
[fastwebsockets](https://crates.io/api/v1/crates/fastwebsockets) registry metadata. They are
candidate pins, not a compiled or qualified combination. tokio-tungstenite declares Tokio
`^1.0.0`, optional Rustls `^0.23.0` and tokio-rustls `^0.26.0`.
[Adapter manifest](https://github.com/snapview/tokio-tungstenite/blob/v0.30.0/Cargo.toml).

Select minimal Tokio features, a Rustls crypto provider, and OS or bundled trust roots
deliberately; verify certificate/hostname rejection and proxy support. Rustls's default
provider is `aws-lc-rs`, with its own platform/build requirements. TLS is not automatically
enabled merely by choosing a WebSocket crate.
[Rustls capabilities](https://docs.rs/rustls/latest/rustls/).

Tungstenite **0.30.0** exposes frame/message/write-buffer limits; defaults include a 64 MiB
message limit and unlimited maximum write buffer. TLS must be selected, and the crate
documents no `permessage-deflate` support. These require deployment qualification.
[Limits](https://docs.rs/tungstenite/0.30.0/tungstenite/protocol/struct.WebSocketConfig.html),
[crate capabilities](https://docs.rs/tungstenite/0.30.0/tungstenite/).

`fastwebsockets` exposes raw frames; use `FragmentCollector` for complete messages. Its
`upgrade` feature supplies client/server HTTP handshakes through Hyper, and its interface
offers automatic Pong/Close handling. Supply TLS separately and qualify masking, message
limits, fragmented/control-frame interleaving, close races and cancellation. It also lacks
`permessage-deflate`. Neither its name nor upstream benchmarks establish superiority for
Hyperion's payloads or reconnect workload.
[Pinned interface](https://docs.rs/fastwebsockets/0.10.0/fastwebsockets/).

Node's built-in, browser-compatible `WebSocket` became non-experimental in **22.4.0**.
A new client targeting supported Node 22/24 versions and browsers can therefore use the
platform client instead of `socket.io-client`.
[Node 22.23.3 source documentation](https://github.com/nodejs/node/blob/v22.23.3/doc/api/globals.md#class-websocket).
This does not provide a Node WebSocket server or remove server-side dependencies.

Rust/WASM needs browser I/O integration; `web-sys::WebSocket` is an external-crate option,
not zero Cargo dependencies. WASM is optional for the JavaScript client.
[wasm-bindgen browser example](https://rustwasm.github.io/docs/wasm-bindgen/examples/websockets.html).

The standard browser WebSocket interface exposes outgoing `bufferedAmount`, but no read-side
backpressure interface. Ping/Pong control frames are not exposed to browser JavaScript.
Use server-side RFC liveness checks and define an application heartbeat if browser code must
observe liveness/progress; do not require JavaScript to send RFC Ping frames.
[WebSocket interface and heartbeat specification](https://websockets.spec.whatwg.org/).

## Accepted zero-dependency core scope

Rust's standard library exposes TCP/UDP networking and `Future`, but no TLS, WebSocket or
JSON client/codec interface. Async does not inherently require Tokio: a caller-driven
`Future`/poll interface or an owned executor can use standard primitives. Requiring
`futures_core::Stream`, however, introduces an external crate. A strict implementation must
own and qualify its envelope codec or explicitly receive those capabilities. Network
framing and TLS can live in the separately permitted adapter.
[std catalog](https://doc.rust-lang.org/std/), [networking](https://doc.rust-lang.org/std/net/),
[Future](https://doc.rust-lang.org/std/future/),
[external Stream trait](https://docs.rs/futures-core/0.3.34/futures_core/stream/trait.Stream.html).

A caller-driven core with an empty Cargo dependency graph does not independently open
`wss://`, authenticate certificates or configure proxies. The accepted adapter supplies those
functions. This distinction remains visible in packaging and documentation.

Windows offers OS WinHTTP WebSocket upgrade/send/receive APIs; `WINHTTP_FLAG_SECURE`
selects TLS. Apple offers `URLSessionWebSocketTask` over TCP/TLS, while its current networking
guidance favors Network.framework for new WebSocket code. Direct Rust FFI is feasible in
principle, not implemented or qualified here.
[WinHTTP upgrade](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpwebsocketcompleteupgrade),
[secure requests](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpopenrequest),
[Apple task](https://developer.apple.com/documentation/foundation/urlsessionwebsockettask),
[Apple guidance](https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api),
[Rust FFI](https://doc.rust-lang.org/reference/items/external-blocks.html).

Linux kTLS does not fill the gap: kernel record encryption is configured after a userspace
TLS handshake. A system OpenSSL/libcurl dependency would still be an external requirement.
Do not implement TLS, silently vendor a TLS library, or invoke a subprocess and label the
result zero dependencies. Under the accepted policy, an explicit TLS adapter is legitimate.
[Kernel TLS interface](https://docs.kernel.org/networking/tls.html).

## Transport versus codec optimization

WebSocket/HTTP3 is a transport choice; JSON/MessagePack/CBOR/Protobuf is a payload-codec
choice. Sending UTF-8 JSON in a binary WebSocket message does not compress or change its
representation. Compare these dimensions independently against the same semantic tests.

| Candidate | Benefit to investigate | Compatibility obligations |
| --- | --- | --- |
| WebSocket + JSON | Existing payload shape, native browser/Node JSON support, simple inspection. | Establish the baseline; batch messages and bound parsing/queues. |
| WebSocket + MessagePack or CBOR | Binary maps/arrays/integers and byte strings. | Specify a JSON-compatible profile, string keys, supported values, size/depth limits and unknown fields. Preserve public decimal-string sequence semantics even if the codec supports native uint64. |
| WebSocket + Protobuf envelope | Typed control fields and generated schema tooling. | Arbitrary contract data needs a defined representation: raw JSON bytes are one option. Avoid projecting exact integers through `google.protobuf.Value.number_value`, which is double. Generated code may require a runtime. |
| Native gRPC | Typed RPC and streaming flow control. | Protocol and infrastructure change; official grpc-web still lacks client/bidirectional streaming. |
| WebTransport | Independent reliable streams; separate unreliable datagrams. | Ledger events require reliable delivery. Qualify browser versions, server infrastructure, certificates and fallback behavior. |

Sources: [MessagePack specification](https://github.com/msgpack/msgpack/blob/master/spec.md),
[CBOR RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html),
[Protobuf encoding](https://protobuf.dev/programming-guides/encoding/),
[ProtoJSON mappings](https://protobuf.dev/programming-guides/json/).
Browser JavaScript has no built-in MessagePack/CBOR/Protobuf codec. A new codec requires
runtime code/dependencies or an owned/generated self-contained implementation; code
generation alone does not guarantee zero runtime dependencies. Keep JSON supported unless
an alternative passes parity and shows a workload benefit, including server encoding cost.

WebTransport is now listed as **Baseline 2026**, newly available since March 2026; older
browsers and individual features still vary. The July 2026 W3C snapshot specifies HTTP/3
and HTTP/2 reliable-only modes. Its QUIC/HTTP3 path needs UDP and suitable proxy/listener
support; do not assume HTTP/2 fallback is implemented end to end. Rust `wtransport` **0.7.2**
is a QUIC/HTTP3 candidate, not a general WebSocket replacement. Treat it as a later measured
experiment rather than making datagram loss or a new deployment requirement part of the
baseline.
[Browser status](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport),
[W3C snapshot](https://www.w3.org/TR/2026/CR-webtransport-20260730/),
[Rust interface](https://docs.rs/wtransport/0.7.2/wtransport/).

Root observed in the actual supported Node **22.23.3/24.22.0** binaries:
`typeof WebTransport === 'undefined'`, `typeof WebSocket === 'function'`, and
`isBuiltin('node:quic') === false`. A WebTransport adapter needs an additional implementation
on that tested baseline. This local observation does not characterize every Node release.

## What the Hyperion protocol still must own

WebSocket replaces framing and connection handling, not subscription correctness. Proposed
requirements:

- Negotiate a protocol version and capabilities through a distinct route/subprotocol and a
  bounded application handshake. Specify request IDs, logical stream IDs and connection
  generations so a stale reply cannot target a replacement subscription.
- Define subscribe/accepted/data/history-end/fork/LIB/cancel/cancelled/error semantics,
  per-request terminal failures, and unknown-field behavior. Start with a JSON envelope and
  canonical decimal-string sequence identifiers. Add a binary codec only after measurement.
- Bound individual frames, reassembled messages, batch sizes, inbound/outbound queues and
  reversible buffers in both bytes and records. Define a per-stream credit/acceptance policy
  and explicit overflow failure. Keep control/heartbeat/cancel handling operational when a
  data consumer stalls; one stalled subscription must not deadlock all control traffic.
- Separate delivery acceptance from application durability. Reconnection alone cannot
  establish retained-history completeness, exactly-once processing, a durable consumer
  checkpoint, canonical fork replacement or LIB correctness. Define inclusive replay and
  explicit unavailable-history errors, then test them against actual Hyperion sources.
- Define timeout, reconnect backoff, cancellation and cleanup behavior; reject old UUIDs or
  generations and invalidate unconfirmed fork data before replay.
- Specify `wss://`, authentication, allowed browser origins, subprotocol validation, proxy
  upgrade forwarding and idle deadlines. Browser constructors expose URL/subprotocols rather
  than arbitrary request headers; choose an authentication mechanism that also works there.

These are proposed application responsibilities inferred from the scope of
[RFC 6455](https://www.rfc-editor.org/rfc/rfc6455.html) and the
[browser interface](https://websockets.spec.whatwg.org/), not guarantees supplied by either.

## Rust-first implementation shape and acceptance

Keep protocol types/validation and subscription transitions separate from network I/O.
Use bounded queues and explicit close semantics. Keep Tokio/Tungstenite/Rustls behind the
accepted separate adapter, with no mandatory third-party types or codecs in the core.
Browser and later language implementations must satisfy the same conformance contract.

The first spike should run Rust and platform JavaScript against the same loopback endpoint,
then the actual Hyperion route/proxy. Test binary/text frames, malformed/oversized messages,
heartbeat timeout, stalled consumers, cancellation, partial-block drops, repeated recovery,
fork replacement, LIB advancement, exact uint64 strings and scoped retryable errors. Run
package and TLS tests on Windows/Linux. Measure bytes, CPU, throughput, latency and peak
buffer occupancy with identical data and correctness checks before making performance claims.
Existing server/client qualification remains
[History API #231](https://github.com/eosrio/hyperion-history-api/issues/231); successful
transport experiments alone do not close it.

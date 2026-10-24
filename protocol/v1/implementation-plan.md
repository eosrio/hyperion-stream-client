# Rust native stream client and shared conformance

Implement the user-approved Rust-first client with a dependency-free core and a
separate Tokio/tokio-tungstenite/Rustls/JSON adapter. The initial transport is
native WebSocket + JSON. This is additive to the legacy Socket.IO client.

The working wire contract is protocol/v1/README.md. The server lane is
eosrio/hyperion-history-api#294, owned by the architecture task. Changes to the
contract must be coordinated between both lanes and recorded in the shared
conformance corpus. Server source/readiness/filter/cancellation guards and the
existing public/internal streaming routes remain required.

Deliverables:
- A standalone Cargo core with no third-party dependencies in any feature.
- Typed public state transitions, bounded per-stream/connection delivery windows,
  generation/request/connection fencing, exact counters, scoped failures,
  cancellation, finite deadlines, inclusive replay and fork/LIB invalidation.
- An optional Tokio adapter with native text WebSocket framing, strict JSON,
  bounded frame/write buffers, deadlines, chain/subprotocol verification and TLS.
- Language-neutral scenarios and wire vectors run by Rust and native JavaScript
  drivers, plus real WebSocket integration including fault/slow-consumer cases.
- Windows/Linux and supported Rust/Node CI, examples and honest scope/limits docs.
- Review, package checks and a concrete PR. Publication and actual retained-chain
  source/fanout/proxy/recovery acceptance remain separate release work under #231.

Acceptance focuses on discovering bugs: stale scopes, partial/duplicate frames,
sequence gaps, integer precision, queue/byte exhaustion, cancellation races,
request/idle/LIB timeout, repeated outages, fork-before-LIB, cross-stream isolation,
draining completion, malformed JSON and TLS identity validation.

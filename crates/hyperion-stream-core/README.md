# hyperion-stream-core

Experimental Hyperion native-stream v1 subscription and recovery state machine.
Zero third-party dependencies, including development/build dependencies. Uses
Rust `std`; no networking, serialization, runtime, TLS or wall clock is required.

Feed typed `Input` values to `Client<R, T>::receive`, inject monotonic milliseconds
with `advance`, execute returned `Command<R>` values, and call `poll` to accept a
ready batch. `R` and `T` are application-owned request/payload types. Batch ACK
means acceptance, never application durability. Save inclusive checkpoints and
deduplicate if durable at-least-once processing is needed.

The state machine owns bounded stream/connection buffers, request/connection/
generation fencing, history/live ordering, cancellation, finite request/finality
deadlines, chain identity, irreversible delivery and inclusive replay. A later
connection cannot release an old reversible buffer. The verified LIB consistency
watermark survives reconnect independently from current delivery eligibility.

For a complete connection use the separate `hyperion-stream-ws` adapter. Core-only
is not a standalone `wss://` client. Full contract and shared conformance live in
the workspace's `protocol/v1` and `conformance/v1` directories.

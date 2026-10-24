# Shared native streaming conformance

`v1/wire-vectors.json` contains literal valid/invalid wire messages. Both the Rust
codec and independent native JSON/BigInt driver consume the same cases. Unknown
fields are reserved extensions; unknown packet types fail.

`v1/scenarios.json` describes state-machine actions and literal public effects.
Operations are server (a decoded wire packet), subscribe, poll, cancel, disconnect,
and advance (injected monotonic milliseconds). Every operation asserts commands
and events, or an explicit fatal code. Expected objects may select fields; arrays
match exactly. Rust runs these through the public core + codec. Future language
clients can add a driver for this same format without translating expectations.

`v1/network-sessions.json` runs the same ordered action/delta history/live exchange
against both the Rust adapter and native Node WebSocket peer. The fixture checks
subscription JSON, exact ACK scopes/order, independent heartbeat controls, record
identity and payload preservation. The Node peer is a test peer, not a production
client with recovery/finality parity. The HAPI lane consumes the pinned corpus in
eosrio/hyperion-history-api#294; fixture success alone does not qualify its real
history, routing, cancellation, filter, fanout or retained-chain completeness.

```sh
node conformance/verify.mjs --core
cargo test --workspace --all-targets --locked
```

Node 24+ must be on PATH for the native network peer. Set `HYPERION_NODE` to an
explicit executable to select another runtime. Core-only tests require only Rust:
`cargo test -p hyperion-stream-core --locked`.

The SHA256 manifest pins the contract and literal corpora. Update it deliberately
when changing scenarios; send the exact Git revision/hash to the server owner.
All corpus text is checked out with LF so frozen hashes match on Windows/Linux.

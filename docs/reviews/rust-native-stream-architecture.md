# Rust-first native streaming: source audit and proposed migration

Investigation date: 2026-10-22. Status: proposal, not a production implementation or accepted
wire protocol. Accepted user direction: Rust first, Python/others only as needed; a zero-deps
core with a separate transport/TLS adapter is acceptable. Existing 4.5 qualification and
the architecture chat's frozen measurement campaign remain independent.

## Recommendation

Replace the public Socket.IO protocol with a versioned Hyperion protocol over standard
WebSocket, initially alongside the existing route. Keep the Rust subscription state machine
free of mandatory third-party crates. Supply runtime, WebSocket, wire codec and TLS through
an explicitly separate adapter. A Tokio + tokio-tungstenite + Rustls adapter is the baseline
candidate, not a zero-dependency complete connection stack.

For JavaScript on supported Node/browser versions, native WebSocket plus native JSON can
support a package with no runtime dependencies. Keep any legacy Socket.IO compatibility
package separate: an installed optional or mandatory Socket.IO dependency would still count.
The current npm package has one direct runtime dependency, `socket.io-client@4.8.4`, with
Engine.IO, parsers and other dependencies underneath it.

Transport and encoding are separate choices. Compare native WebSocket with JSON, bounded
batching and explicit delivery windows first; then evaluate binary codecs against the same
records and correctness checks. No performance improvement has yet been demonstrated.
The [transport research](socketio-removal-transport-research.md) compares Rust crates,
alternative transports, browser constraints and codec candidates.

Rust adapter candidates are Tokio/tokio-tungstenite/Rustls as the initial implementation,
fastwebsockets as a measured alternative, and WebTransport as a separate experiment. These
are not competing choices for the zero-deps core. In local runtime probes, Node 22.23.3 and
24.22.0 both expose `WebSocket`, but have neither a `WebTransport` global nor a `node:quic`
builtin. Current browser WebTransport support is broader ([Baseline 2026](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport));
the Node results are a concrete constraint on using it as the single zero-runtime-deps
JavaScript transport for our present baseline, not a claim about every Node release.

## Actual Socket.IO scope in Hyperion

Source audit pins: stream client `99ad2cf1ee47ee7c8c5cf3ea7a4f35bfbdf4ff11`; History API
`release/4.5` at `37035935facb306207194d8309d29542d68b8ad6`. These are investigation
references, not a newly qualified release combination.

| Use | Observed implementation | Replacement work |
| --- | --- | --- |
| Public `/stream` | `SocketManager` constructs a WebSocket-only Socket.IO server on a uWebSockets.js app. The current client also selects WebSocket-only mode. | Add a distinct native endpoint/subprotocol, application handshake and connection registry. HTTP polling fallback is not part of this public path today. |
| API to indexer `/router` | The API is a Socket.IO client; the router is a Socket.IO server. It carries registrations, cancellations, client counts, block/action/delta data and fork/LIB notifications. | Migrate this separately; a native public endpoint alone does not remove internal Socket.IO. Preserve relay replacement, request ownership and disconnect cleanup. |
| Cross-API broadcast | The public Socket.IO server uses the Redis adapter keyed by chain ID. Status, fork and LIB events use broadcasts; live records address local socket IDs directly. | Define native fanout ownership and test multiple API workers, duplicate events, restarts and slow clients. Do not silently remove this behavior with the adapter. |
| History delivery | `streamPastCommon` accepts a Socket.IO `Socket`, waits for each batch ACK with a 120-second deadline, and clears the Elasticsearch scroll in `finally`. | Extract a transport-independent history sink with cancellation and bounded acceptance. Preserve source/projection proof guards and resource cleanup. |
| Hub publication | `base-publisher.ts` separately connects to an external query hub over Socket.IO with a fresh authenticated session. The master also retains a Socket.IO hub type. | Coordinate that peer protocol separately if the goal includes removing Socket.IO from the entire HAPI dependency tree. |

Pinned source: [public listener and Redis adapter](https://github.com/eosrio/hyperion-history-api/blob/37035935facb306207194d8309d29542d68b8ad6/src/api/socketManager.ts#L81-L101),
[API relay](https://github.com/eosrio/hyperion-history-api/blob/37035935facb306207194d8309d29542d68b8ad6/src/api/socketManager.ts#L209-L281),
[internal router](https://github.com/eosrio/hyperion-history-api/blob/37035935facb306207194d8309d29542d68b8ad6/src/indexer/workers/ws-router.ts#L424-L491),
[history delivery and cleanup](https://github.com/eosrio/hyperion-history-api/blob/37035935facb306207194d8309d29542d68b8ad6/src/api/helpers/functions.ts#L279-L340),
[hub connection](https://github.com/eosrio/hyperion-history-api/blob/37035935facb306207194d8309d29542d68b8ad6/src/api/qry-hub/base-publisher.ts#L141-L158),
[current client](https://github.com/eosrio/hyperion-stream-client/blob/99ad2cf1ee47ee7c8c5cf3ea7a4f35bfbdf4ff11/src/hyperion-stream-client.ts).

The server already has a native WebSocket implementation through uWebSockets.js. This
proposal does not require rewriting the API server in Rust or adding another broker.

## Reproduced wire compatibility constraint

The [diagnostic probe](../../scripts/probes/socketio-wire-probe.mjs) runs a real loopback
Socket.IO 4.8.4 server with the same public path/WebSocket transport profile and a native
Node WebSocket client. It is a protocol fixture, not the production SocketManager.

Executed on native Node 22.23.3 and 24.22.0:

| Probe | Both runtimes observed |
| --- | --- |
| Plain WebSocket to `/stream/` | No WebSocket connection; no subscription request reached the server. |
| Engine.IO query parameters, then a plain JSON subscribe command | WebSocket opened and returned the Engine.IO session/heartbeat envelope, then closed without registering a request. |
| Minimal Engine.IO/Socket.IO framing | Namespace connection, Hyperion-style handshake and a correlated request ACK succeeded. |

The last probe explicitly sends `40` and a `427[...]` event and receives `437[...]`.
It illustrates why replacing the npm import with native WebSocket while retaining the old
endpoint keeps the Engine.IO/Socket.IO protocol obligation. The probe is intentionally not
a maintained Socket.IO reimplementation. Run with `node scripts/probes/socketio-wire-probe.mjs`.

As a local artifact baseline, the current UMD is 62,157 bytes, or 18,382 bytes with Node's
default gzip. There is no native replacement artifact to compare yet; these numbers are not
a claimed saving or evidence that transport is the current indexing bottleneck.

## Proposed module shape

```text
protocol/                       schemas, semantics, versioned scenarios
crates/hyperion-stream-core/     zero mandatory third-party crates
crates/hyperion-stream-ws/       optional runtime/WebSocket/codec/TLS adapter
packages/typescript-native/     platform WebSocket + JSON
packages/legacy-socketio/       explicit compatibility installation
conformance/                   common fixture runner and language drivers
```

The core owns subscription transitions, inclusive recovery boundaries, history/live ordering,
stale-generation rejection, bounded application queues, fork/LIB invalidation, errors and
cancellation. Its inputs/outputs are typed Rust values and explicit effects, independent of
networking, clocks, Serde and Tokio. The adapter performs I/O, wire encoding/decoding, timers
and certificate verification. Adapter dependencies and feature selections remain visible.
Existing JavaScript paths need not move during the investigation.

On HAPI, extract a `StreamSession`/history-sink seam so both adapters share request validation,
history/filter logic, canonical-source/projection guards and lifecycle cleanup. Merely adding
a second sender around the current Socket.IO-specific maps is insufficient for native
registration, cancellation, cross-worker broadcast and relay recovery.

## Protocol requirements before implementation

A candidate `/stream/v2` route with a versioned subprotocol is a proposal, not a reserved
or implemented endpoint. Specify:

- Chain identity, supported wire version, capabilities, request correlation IDs, logical
  subscription IDs and connection/subscription generations. Do not use a Socket.IO socket ID
  as a durable consumer identity.
- Subscribe/accepted, data batches, history completion, fork/LIB notifications, cancel and
  terminal failures. Preserve exact decimal-string sequences and arbitrary contract fields.
- Bounded acceptance windows in records and bytes for both history and live data, deadlines,
  and explicit slow-consumer failure. Reserve control capacity so stalled data does not block
  cancellation, errors or heartbeat processing. Shared indexing must remain protected from
  one slow subscription.
- Inclusive replay from the earliest unread/unconfirmed position, canonical fork replacement,
  and scoped failure when retained inputs are unavailable. Delivery ACKs remain distinct from
  application durability; transport changes do not create exactly-once delivery.
- TLS/origin/authentication policy, heartbeat behavior compatible with browser interfaces,
  proxy upgrade/idle settings, frame/message limits, and validated error/version handling.

These semantics are inferred requirements for the replacement. [WebSocket](https://www.rfc-editor.org/rfc/rfc6455.html)
does not supply them. [Socket.IO](https://socket.io/docs/v4/delivery-guarantees/) also leaves
additional arrival guarantees to the application.

## Staged migration and acceptance

1. Freeze the contract, limits and shared conformance scenarios; keep legacy 4.5 work moving.
2. Build the zero-deps Rust core and optional adapter against a bounded native fixture, with
   a platform-JavaScript peer to check cross-language behavior and the zero-runtime-deps path.
3. Integrate a native HAPI adapter through the shared session/history seam. Run legacy and
   native routes against the same actual retained dataset, proxy and recovery/finality cases.
4. Compare JSON/binary encodings and candidate Rust transports using identical payloads,
   TLS/proxy settings, fault schedules and memory bounds. Measure parsing/allocation, wire
   bytes, throughput, tail latency, CPU and peak queue occupancy; include overlapping and
   slow subscriptions. Accept only runs with matching source completeness and identities.
5. Migrate the internal router and replace cross-worker broadcast deliberately. Retire legacy
   public transport only after an explicit supported-server/client migration decision. Any
   whole-HAPI dependency removal also needs a compatible external hub migration.

[HAPI #231](https://github.com/eosrio/hyperion-history-api/issues/231),
[release matrix #20](https://github.com/eosrio/hyperion-tools/issues/20), and
[release coordination #24](https://github.com/eosrio/hyperion-tools/issues/24) remain the
qualification owners. Neither this report, the diagnostic fixture nor a codec benchmark
closes those gates. No production source, lockfile, package dependency or service changed.

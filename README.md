# Hyperion Stream Client

Typed action and table-delta subscriptions over Hyperion's Socket.IO `/stream` transport.
Supports Node.js 22/24, ES modules, CommonJS, and modern browsers.

This checkout contains the client preparation for Hyperion 4.5. The client versions
independently of the server. Merging changes does not publish an npm release or qualify
every server deployment. See [migration notes](docs/MIGRATION.md) and the
[launch checklist](docs/LAUNCH.md).

An experimental [Rust native client](crates/hyperion-stream-ws/README.md) is also
available in this workspace: a [zero-dependency core](crates/hyperion-stream-core/README.md)
and a separate Tokio/Tungstenite/Rustls adapter. It targets the additive native
WebSocket + JSON protocol coordinated in [HAPI #294](https://github.com/eosrio/hyperion-history-api/issues/294).
See the [wire contract](protocol/v1/README.md) and [shared conformance](conformance/README.md).
The native endpoint and retained-chain acceptance are still being integrated.

## Usage

```sh
npm install @eosrio/hyperion-stream-client
```

```js
import {HyperionStreamClient} from '@eosrio/hyperion-stream-client';
// CommonJS: const {HyperionStreamClient} = require('@eosrio/hyperion-stream-client');

const client = new HyperionStreamClient({endpoint: 'https://your-hyperion.example'});
client.on('error', error => console.error(error));

try {
    await client.connect();
    const stream = await client.streamActions({
        contract: 'eosio.token',
        action: 'transfer',
        start_from: -100,
        replayOnReconnect: true
    });
    for await (const message of stream) {
        console.log(message.mode, message.content);
        // Await application processing here. Break cancels this subscription.
    }
} finally {
    client.disconnect();
}
```

Alternatively, use `stream.on('message', message => ...)` and `stream.stop()`.
The first message listener receives cached messages that arrived during subscription setup.
An event-only stream retains a bounded recent-message cache for a later iterator. Use one
iterator per stream for sequential asynchronous work. Event callbacks do not delay packet ACKs.
Thrown exceptions and rejected observer promises reach the client `error` event. Failures in
client error observers are contained to prevent recursive errors.

`connect()` waits for the chain handshake and rejects on connection failure or timeout.
Concurrent calls share one connection. `disconnect()` closes all subscriptions, completes
waiting iterators, and clears connection state; create new subscriptions after reconnecting
explicitly. A transient transport loss preserves established subscriptions for automatic reconnect.

## Requests

`await client.streamActions(request)` and `await client.streamDeltas(request)` return a
`HyperionStream`. Identical normalized requests share a stream, including their consumers
and cancellation. Delivery flags are part of identity. Caller-owned requests are copied.

| Parameter | Meaning |
| --- | --- |
| `contract`, `action`, `account` | Action selectors. Supply an account, or both contract and action. |
| `code`, `table`, `scope`, `payer` | Delta selectors. Code and table are required. |
| `start_from` | `0`/omitted: live from head. Positive integer: absolute block. Negative integer: offset from head. ISO timestamp: historical time. Numeric strings normalize to numbers. Legacy `'LIB'` resolves using the chain API. |
| `read_until` | Historical upper bound, using a block number, offset, or ISO timestamp. `0`/omitted means no explicit historical bound. |
| `ignore_live` | Set `true` for finite history. The iterator completes after `history_end` and buffered irreversible delivery. |
| `filters`, `filter_op` | Server-side filters and `and`/`or` combination. Support and history/live equivalence depend on the server. |
| `replayOnReconnect` | Default `false`. If enabled, replay inclusively from the earliest unread/unconfirmed block or last delivered block after reconnect. |

For finite reads use `ignore_live: true` with a historical `start_from` and, optionally,
`read_until`. A live subscription does **not** stop automatically at `read_until`.
Exact account/contract/table names are the portable baseline; wildcard, filter, and
optional-scope behavior require server qualification. See [launch limitations](docs/LAUNCH.md).

```js
const history = await client.streamDeltas({
    code: 'eosio.token', table: 'accounts', scope: 'alice',
    start_from: 1000, read_until: 2000, ignore_live: true
});
for await (const row of history) console.log(row.content);
```

Replay provides **at-least-once delivery**, subject to the server retaining the requested
history. Replaying the last block avoids skipping records after a partial batch; consumers
must tolerate duplicates. There is no durable consumer checkpoint or exactly-once guarantee.
Handle `client.on('fork', ...)` when applying reversible data. LIB mode buffers records
until confirmation and removes buffered forked records.
Transport loss or relay outage invalidates unconfirmed records from the old connection.
With replay enabled, the client replaces them from history and rejects stale subscription UUIDs.
Without replay, a LIB stream holding unconfirmed data fails with retryable
`code: 'STREAM_REPLAY_REQUIRED'`; enable replay or create a new subscription from your checkpoint.

Hyperion 4.5 represents global, receiver, and authorization uint64 sequences as canonical
decimal strings. The client preserves those strings through history, binary live packets,
metadata, and LIB buffers. Store them as strings or use `BigInt` for arithmetic; converting
them to `Number` can lose identity. The public action types describe this 4.5 contract;
older servers with numeric sequences require explicit application migration.

## Options and events

| Client option | Default | Purpose |
| --- | --- | --- |
| `endpoint` | Required | Hyperion origin, with optional trailing `/stream`. The reverse proxy must forward `/stream` and WebSocket upgrades. |
| `chainApi` | Endpoint | HTTP chain API used for legacy `'LIB'` lookup. |
| `connectionTimeout` | `5000` | Initial and reconnect handshake deadline, in milliseconds. |
| `requestTimeout` | `10000` | Subscription ACK and legacy chain lookup deadline, in milliseconds. |
| `libStream` | `false` | Deliver only confirmed data, marked `irreversible: true`. |
| `libMonitor` | `false` | Report stalled LIB updates through the client error event. |
| `maxQueueSize` | `1000` | Per-stream iterator/cache and history-to-live buffer bound. |
| `maxReversibleBufferSize` | `10000` | Shared bound for data waiting for LIB. |
| `debug` | `false` | Enable diagnostic logs. |

Limits must be positive integers. `stream.setMaxQueueSize(n)` adjusts one stream.
An active iterator or unobserved stream that overflows fails explicitly; it does not silently
skip records. Size queues for server batch sizes and processing latency. Event-only caches
retain recent records. A packet ACK means accepted into bounded client memory, not committed
by the application. Use your own durable, idempotent processing and replay checkpoints.

Client events: `connect`, `error`, `data`, `libData`, `libUpdate`, `fork`.
Stream events: `start`, `message`, `historyEnd`, `error`, `end`.
Completion and failure state remain observable when listeners attach after setup has finished.
Both support `on`, `off`, and `once`. For a `start` listener, create the stream before
connecting, attach the listener, then call `connect()`. Stream failures reject iterator reads;
setup failures reject `streamActions`/`streamDeltas` promises. Cancellation completes reads.
Server error `statusCode`, `retryable`, and `code` fields are retained on the emitted/rejected
error when supplied, so applications can distinguish retryable projection unavailability.

## Browsers

Bundlers can use the package's ESM export. To test a source checkout directly, build it
and serve the repository root. A browser import map needs a real ESM dependency:

```html
<script type="importmap">
{"imports":{"socket.io-client":"https://cdn.jsdelivr.net/npm/socket.io-client@4.8.4/dist/socket.io.esm.min.js"}}
</script>
<script type="module">
import {HyperionStreamClient} from '/lib/esm/index.js';
const client = new HyperionStreamClient({endpoint: 'https://your-hyperion.example'});
</script>
```

For a global constructor use `<script src="/dist/hyperion-stream-client.js"></script>`.
The UMD bundle is self-contained; it is not an ESM import-map target.
Automated Chromium tests exercise both formats against a loopback server.

## Development

Node 22/24, TypeScript 7.0.2, and Bun 1.4.3 are the acceptance baseline.
`package-lock.json` is authoritative; Bun supplies the complete-project checker.

```sh
npm ci
npm run typecheck
npm test                 # builds ESM, CommonJS and UMD, then runs local protocol regressions
npm run test:cjs         # run the same protocol suite against CommonJS
npm run test:package     # pack, install externally, check both runtimes and declaration formats
npx playwright install chromium
npm run test:browser     # real Chromium ESM and UMD protocol tests
npm audit
```

`npm pack` builds all formats through `prepack`. CI runs Node 22/24 on Linux and Windows;
Chromium acceptance runs on Linux/Node 24. The default tests use no public Hyperion endpoint.
Manual browser smoke pages are available through `npm run serve:tests`.
The default ESM suite enforces 95% lines, 88% branches, and 90% functions for core runtime
coverage. See the [bug-discovery report](docs/reviews/adversarial-coverage.md) for scope and results.

MIT license. [Issues](https://github.com/eosrio/hyperion-stream-client/issues).

# Migrating to the v4 client

The Hyperion 4.5 launch work builds on the existing v4 release candidate. The package keeps
its independent version; this change does not publish a release.

- Use Node 22 or 24 and the one-argument constructor: `new HyperionStreamClient({endpoint})`.
  The old constructor's injected fetch function is gone; modern Node and browsers provide fetch.
- Hyperion 4.5 global/receiver/authorization uint64 sequences are decimal strings on all
  chains, including Antelope. The public action types reflect this intentional server contract
  change. Preserve them as strings or use BigInt; never reconstruct an exact identity from
  an unsafe Number. uint32 code/ABI counters, block numbers, and ordinals remain numeric.
- Server retryability/status/code metadata remains on stream setup and delivery errors.
- Replace `setAsyncDataHandler` and `setAsyncLibDataHandler` with a stream iterator for awaited
  application work. Use `on('message')` or client `data`/`libData` events for synchronous observers.
  `libStream: true` applies to both stream consumers and client events.
- Await `streamActions`/`streamDeltas`; they return a stream with its own `stop()` and events.
  The first message listener replays the bounded setup backlog. For start-event observation,
  create the stream before `connect()`, attach listeners, then connect.
- `start_from: 0` means live from head. Legacy case-insensitive `'LIB'` remains supported and
  resolves the actual chain LIB. Numeric strings normalize to numeric block ranges.
- Use `ignore_live: true` for terminating history iterators. `read_until` bounds historical
  replay; it does not terminate a live subscription. Stop live streams explicitly.
- Requests are copied and equivalent normalized requests return the same subscription.
  Different delivery/replay flags identify different streams. Stopping a shared stream stops
  all consumers of that subscription.
- `replayOnReconnect: true` replays the last delivered block inclusively. Deduplicate records
  in application storage. Forks still require application rollback for data already delivered
  before LIB. No durable application acknowledgement or exactly-once promise is provided.
  Unread/unconfirmed records can move the replay boundary earlier. Repeated disconnects
  preserve that boundary until replacement data arrives; stale UUID packets are discarded.
- Transport loss or relay outage discards unconfirmed LIB buffers. If replay is disabled and
  the stream holds such data, it fails with retryable `STREAM_REPLAY_REQUIRED` rather than
  risking confirmation of a stale fork. Enable replay for continuous LIB subscriptions.
- Explicit `disconnect()` ends subscriptions and iterators. Automatic transport reconnect
  preserves established subscriptions. A setup interrupted by disconnect rejects promptly;
  callers can retry after the next connection.
- Subscribe to `error` and catch iterator failures. Queue overflow, rejected/malformed packets,
  and server historical errors are observable failures rather than silent truncation or hangs.
  Rejected observer promises also reach the client error event, without delaying packet ACKs.
  Explicit stop discards queued records; natural history completion still allows draining them.

ESM imports and CommonJS `require()` use conditional exports with matching declarations.
Use the UMD bundle only as a script/global constructor; browser import maps must map the
actual ESM entry and `socket.io-client` dependency.

Historical reports [#13](https://github.com/eosrio/hyperion-stream-client/issues/13) and
[#14](https://github.com/eosrio/hyperion-stream-client/issues/14) involved Node16/client1.0.3
and older deployments. Current loopback regressions cover related failure modes; they do not
reproduce those deployments or establish server history completeness.

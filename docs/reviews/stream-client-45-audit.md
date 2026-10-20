# Hyperion Stream Client 4.5 launch audit

Research snapshot: 2026-10-20. This document records the incoming baseline, not acceptance of subsequent fixes.

## Fixed points and scope

- PR [#17](https://github.com/eosrio/hyperion-stream-client/pull/17) incoming head: [`456b984687279dbefda41847580092d4aa923beb`](https://github.com/eosrio/hyperion-stream-client/commit/456b984687279dbefda41847580092d4aa923beb), `dev`.
- Incoming `master`: [`828ce98ced2e595b00c55852c42b5fa83f920869`](https://github.com/eosrio/hyperion-stream-client/commit/828ce98ced2e595b00c55852c42b5fa83f920869).
- Server source examined: [`79af10986bc0e2aa84cce3788aea202d23547818`](https://github.com/eosrio/hyperion-history-api/commit/79af10986bc0e2aa84cce3788aea202d23547818). The socket manager and streaming helpers examined were unchanged in the otherwise dirty server checkout.

GitHub reported PR17 mergeable with a clean merge state and **no status checks**. That describes merge mechanics, not runtime qualification. Research used pinned repository source and first-party GitHub issue/PR APIs. No GitHub mutations, dependency changes, or source edits were made by this audit.

## Client blockers before merging PR17

1. **Historical acknowledgements depend on the consumption API.** A history batch only acknowledges inside a stream event handler or when the iterator reaches an empty queue. Listening solely to `client.on('data')` delivers data without acknowledging it, so the real server waits for its scroll acknowledgement timeout. The stream handler acknowledges before processing the rest of the batch, so asynchronous handlers do not supply processing backpressure. Acknowledge only after an explicit delivery boundary, support every documented consumption mode, and define async consumer guarantees. Sources: [stream implementation][stream], [server history delivery][history].

2. **Iterator truncation and completion lose information.** Before iterator activation, the default 1,000-item buffer silently discards older messages. Once active, it can grow without a limit. `history_end` only resolves a currently pending iterator with `null`; an iterator started afterward waits forever, and a consumer that continues after the null sentinel waits again. `stop()` does not finish a pending iterator; breaking an iterator does not stop its stream. Store terminal state independently, define bounded buffering/overflow, and test an end received before consumption. Source: [stream implementation][stream].

3. **Irreversible streaming is disconnected.** Every decoded message is emitted with `irreversible:false`; no current path populates `reversibleBuffer`. The client still exposes `libStream` and a drain queue but cannot deliver its advertised irreversible data. Merely forwarding `lib_update` is insufficient. Fork handling also only forwards an event; buffered forked messages need an explicit rollback rule. Sources: [client implementation][client], [stream implementation][stream], [README][readme].

4. **Reconnect can skip or duplicate data.** Both replay paths start at `lastReceivedBlockNum + 1`, although more actions or deltas may remain in the last partially delivered block. Connect processing and the server's later `resend_requests` can independently restart the same stream. `relay_restored` uses `savedRequests`, but creation no longer populates that collection. Define replay from the last block with stable identities/deduplication, serialize recovery, and cover action-only, delta-only, mixed, relay recovery, and server restart cases. Sources: [client implementation][client], [stream implementation][stream], [server reconnect][socket].

5. **Request failures can hang or become sticky.** Setup acknowledgements have no bounded timeout. A failed request remains in maps and may be returned as a duplicate on retry. Incoming historical `{error, messages:[]}` frames are ignored rather than reaching listeners or rejecting iterators. Cancellation relies on a server acknowledgement and can splice index `-1`, removing another stream. Source: [client implementation][client], [stream implementation][stream]; real error frame: [server history limit][history].

6. **Request identity and event lifecycle are incomplete.** Hash input omits `ignore_live` and `replayOnReconnect`, so distinct requested behavior can share one stream. Caller-owned request objects are mutated during replay. Client `once()` invokes only one registered listener per emission; `off()` removes the final unrelated listener when `findIndex()` returns `-1`. Source: [client implementation][client], [stream implementation][stream].

## Server contract gaps that client-only tests cannot resolve

These findings concern the pinned server checkout. They require server fixes or clearly scoped compatibility documentation; they are not evidence that every public endpoint runs this code.

| Gap | Evidence and implication |
| --- | --- |
| Action-only reconnection | `handleSocketConnection` checks only `clientDeltaRequestMap` before recovering an old socket. Action-only connections take the resend path. Disconnect cleanup detaches only deltas. `detachActionRequests` uses the payer map and deletes the delta reverse index. [Socket manager][socket] |
| Contract plus account live filters | The router passes `notifiedAccounts:string[]` into `processActionRequests`/`checkActionFilters`, which declares `account:string` and compares it to `request.account` with strict equality. A contract/action/account request cannot match that array. Historical queries separately allow authorization actors, creating another live/history semantic mismatch. [Socket manager][socket], [live filters][livefilters], [historical query][history] |
| Wildcards promised but rejected | The router supports `'*'` branches and history omits wildcard terms, but validation calls `Name.from()` and performs exact ABI action/table lookups. README wildcard examples therefore require server validation repair. Optional delta scope is also unconditionally name-validated. [Socket manager][socket], [README][readme] |
| False/zero filters differ by mode | History includes a filter only if `f.field && f.value`, silently skipping `false`, `0`, and empty strings. Live uses the filter list without this truthiness gate. [History][history], [live filters][livefilters] |
| OR has wrong historical semantics | Indexed terms enter an Elasticsearch `should` group, while other filters run afterward. Mixed groups effectively intersect the indexed and postfilter groups instead of taking their union. All-postfilter OR leaves an empty `should` group with `minimum_should_match:1`; verify the resulting Elasticsearch behavior explicitly. [History][history] |
| Range representations are not interchangeable | Every nonempty string becomes a timestamp constraint. The README's numeric-string `"-100"` is not a relative block number on this server. `start_from:0` takes the live-only path rather than resolving LIB. Mixed/relative range validation compares raw values before normalization. [History range helper][ranges], [socket manager][socket], [README][readme] |
| Cancellation and historical errors | Local live-routing maps are attached before relay setup; cancel handling only forwards to the relay. Historical failures can return without a terminal frame; an exception inside `processStreamRequest` is logged and swallowed. Test cancellation during history and server-side query/scroll failure. [Socket manager][socket], [history][history] |

## Packaging, browser promises, and migration

- The incoming package exports generated `lib/esm` and `lib/cjs` files, but a clean checkout has no `lib`; there is no `prepack`/`prepare` build hook. Qualification must pack a clean build and install that tarball into external ESM, CommonJS, and TypeScript consumers. Check the actual publish file list and declarations, not source imports. Sources: [package manifest][package], [npm exclusions][npmignore], [hybrid package script][hybrid].
- README maps a UMD script to a module import with a named export. The UMD output has no native ESM export, so this is not a valid import-map shortcut. The dedicated ESM browser fixture itself has a trailing comma in JSON and maps `../lib` from `/test/browser`, yielding `/test/lib`, not `/lib`. Sources: [README][readme], [webpack output][webpack], [browser fixture][browser].
- Bare `crypto.subtle` in request hashing conflicts with the claimed Node18 floor: the Node documentation records removal of the experimental global webcrypto flag in v19. Avoid the global requirement or declare and test an appropriate runtime floor. Sources: [stream hashing][stream], [Node global crypto history](https://nodejs.org/api/globals.html#crypto).
- Browser WebSocket-only connections ignore `extraHeaders`; the existing explicit reconnect event matters. Reverse proxies must forward the Socket.IO `/stream` transport path, which is distinct from a URI namespace. Sources: [client socket options][client], [Socket.IO client documentation](https://socket.io/docs/v4/client-options/#extraheaders).
- PR17 removes `setAsyncDataHandler`, `setAsyncLibDataHandler`, and client-side `'LIB'` resolution. The old master **does** explicitly implement case-insensitive `'LIB'` by fetching chain `get_info`; the historical review reply that it never existed contradicts source. Preserve compatibility or document and test migration. Sources: [old client implementation][oldclient], [PR17 review discussion](https://github.com/eosrio/hyperion-stream-client/pull/17), [new client][client].

## Open PR and issue disposition

| Item | Recommendation |
| --- | --- |
| [PR17: v4 merge](https://github.com/eosrio/hyperion-stream-client/pull/17) | Finish runtime, package, browser, and migration qualification on `dev`; merge the tested head into `master`. The baseline alone is not ready. |
| [PR16: socket.io-parser 4.2.3](https://github.com/eosrio/hyperion-stream-client/pull/16) | Close as superseded after qualified PR17 lands: incoming dev already locks 4.2.4. |
| [PR15: webpack 5.76.0](https://github.com/eosrio/hyperion-stream-client/pull/15) | Close as superseded after PR17: incoming dev locks 5.101.3. |
| [PR12: browserslist 4.21.4](https://github.com/eosrio/hyperion-stream-client/pull/12) | Close as superseded after PR17: incoming dev locks 4.24.4. |
| [PR11: path-parse 1.0.7](https://github.com/eosrio/hyperion-stream-client/pull/11) | Close as superseded after PR17: incoming dev already locks 1.0.7. |
| [PR4: Node fetch instructions](https://github.com/eosrio/hyperion-stream-client/pull/4/files) | Close as superseded by current documentation. Its two-argument constructor and `node-fetch` injection describe the removed API. |
| [Issue13: silent connection failure](https://github.com/eosrio/hyperion-stream-client/issues/13) | Add deterministic timeout/error regression and `/stream` proxy/version guidance. Maintainer comments already identify server compatibility and proxy forwarding. Close only against verified current behavior; do not claim the 2022 deployment was reproduced. |
| [Issue14: incomplete history/live](https://github.com/eosrio/hyperion-stream-client/issues/14) | Add multi-batch delivery/ACK, history-live boundary, account, and reconnect regressions. Its Node16/client1.0.3 environment is historical; current client/server defects can cause related symptoms, but the original deployment/root cause remains unverified. |

Dependency supersession evidence is the [incoming dev lockfile][lock]. These versions show that the individual old bumps are obsolete, not that a current dependency audit passes.

## Audit probes and acceptance limits

A read-only Node26 probe stripped TypeScript types from the original `HyperionStream` source in memory and supplied a synchronous queue plus client spy. It reproduced:

```text
client-only history data handler: clientDataEvents=1, acknowledgements=0
1005 messages buffered before iterator: first yielded block=6, remaining=999
server error frame with empty messages: stream error events=0
history_end before iterator starts: next() still pending after 30ms
```

The queue stub makes these focused state-machine probes, not Socket.IO transport acceptance. No public chain was used by the audit. The original test suite connects to a public Libre endpoint and explicitly allows streaming tests to pass without receiving any messages; passing it would not establish history completeness or live acceptance. Source: [test setup][setup], [streaming tests][tests].

Release acceptance should therefore include a deterministic local Socket.IO server with exact multi-page counts, same-block reconnect, rejection/timeout/cancel cases, history-live overlap, LIB/fork behavior, and the packed consumer/browser matrix. Public endpoint smoke results should separately name the server version and observed scenario. Publishing an npm version or claiming all server 4.5 paths qualified requires its own evidence.

[client]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/src/hyperion-stream-client.ts
[stream]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/src/hyperion-stream.ts
[oldclient]: https://github.com/eosrio/hyperion-stream-client/blob/828ce98ced2e595b00c55852c42b5fa83f920869/src/hyperion-stream-client.ts
[readme]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/README.md
[package]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/package.json
[npmignore]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/.npmignore
[hybrid]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/scripts/create-dist-packages.mjs
[webpack]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/webpack.config.cjs
[browser]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/test/browser/import-map-esm-test.html
[lock]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/bun.lock
[setup]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/test/setup.js
[tests]: https://github.com/eosrio/hyperion-stream-client/blob/456b984687279dbefda41847580092d4aa923beb/test/streaming.test.js
[socket]: https://github.com/eosrio/hyperion-history-api/blob/79af10986bc0e2aa84cce3788aea202d23547818/src/api/socketManager.ts
[history]: https://github.com/eosrio/hyperion-history-api/blob/79af10986bc0e2aa84cce3788aea202d23547818/src/api/helpers/functions.ts#L79
[ranges]: https://github.com/eosrio/hyperion-history-api/blob/79af10986bc0e2aa84cce3788aea202d23547818/src/api/helpers/functions.ts#L730
[livefilters]: https://github.com/eosrio/hyperion-history-api/blob/79af10986bc0e2aa84cce3788aea202d23547818/src/api/helpers/streamFunctions.ts

# Stream client: Hyperion 4.5 launch acceptance

The client is an independently versioned part of the 4.5 launch. PR
[#17](https://github.com/eosrio/hyperion-stream-client/pull/17) integrates the existing v4
work and the lifecycle, packaging, dependency, and documentation fixes. No npm publication,
production deployment, or universal server compatibility follows from that merge.

## Implemented acceptance

- Initial and reconnect handshakes have deadlines; concurrent connects share a socket.
- Subscription setup errors/timeouts are observable. An interrupted initial setup rejects
  promptly. Late successful ACKs are cancelled rather than leaking remote subscriptions.
- Complete packets are ACKed once after bounded-memory acceptance, independently of consumer
  attachment. Unknown historical requests are NACKed. Server historical errors fail streams.
- History precedes buffered live data. Both event and iterator consumers can receive data
  delivered immediately with the setup ACK. History-only completion works before/after a
  consumer attaches. Stop, disconnect, and iterator return release pending reads and maps.
- Reconnect replay includes the last delivered block, with at-least-once semantics. Requests
  are copied, identities include delivery flags, and relay restoration rebuilds registrations.
- LIB buffering works for both consumers and client events. Forked buffered records are
  removed; queue overflow fails explicitly. Reentrant stop during LIB delivery leaves no buffer.
- The accepted all-chain decimal-string sequence contract is represented in action/receipt
  types and tested at neighboring 2^53 values, 2^63 and uint64 max through history/live packets.
  Server projection error retryability, status, and code survive setup and delivery failures.
- TypeScript 7.0.2 emits ESM/declarations, CommonJS bundles emitted JS, and UMD bundles the
  emitted browser entry. Bun 1.4.3 checks the complete source project, including examples.
- npm lockfile/pins, prepack build, explicit publish files, conditional declaration exports,
  external ESM/CJS/TypeScript consumer checks, and Chromium ESM/UMD acceptance are present.
- CI runs Node 22/24 on Linux and Windows and real Chromium on Linux/Node24.

Protocol regressions use a real loopback Socket.IO server. They do not stand in for a running
Hyperion server, Elasticsearch query correctness, retained history, or a production proxy.
See CI on the final PR commit for the exact runtime/platform results.

## Required server integration before broad launch qualification

[history-api #231](https://github.com/eosrio/hyperion-history-api/issues/231) owns observed
release-branch gaps: action-only reconnect detection and action cleanup maps;
nonsequence false/zero/OR filter equivalence; wildcard and optional scope validation;
cancellation; and request-scoped historical failure termination. The release branch already
fixes account-array matching and client-ID replacement; those remain integration regressions
rather than unresolved predicate defects. The issue pins both main and release source
and defines end-to-end acceptance with known history, mid-block disconnect, fork, and LIB.

Use exact selector names as the portable baseline. `read_until` currently bounds historical
replay; it does not terminate live routing. Use `ignore_live: true` for finite reads.
Replayed data can contain duplicates. There is no durable application checkpoint or exactly-once
contract; the application must persist idempotent results and handle reversible forks.

Track cross-repository qualification with [tools #20](https://github.com/eosrio/hyperion-tools/issues/20)
and [release coordination #24](https://github.com/eosrio/hyperion-tools/issues/24).

## Backlog disposition

Dependency PRs #11, #12, #15, and #16 are superseded by the refreshed locked dependencies.
PR #4 describes the removed two-argument constructor and fetch injection; the migration guide
and current README replace it. Close these obsolete proposals after PR #17 is merged.

Client issues #13 and #14 came from Node16/client1.0.3 and old deployments. Modern regressions
cover silent connection failure, stalled batches, and the history/live transition. Their original
environments were not reproduced. Keep #14 open for actual server/client source-completeness
qualification under server issue #231; retain #13 until the reporter's proxy/version assumptions
are independently resolved or the maintainers choose an explicit historical-issue policy.

The [incoming audit](reviews/stream-client-45-audit.md) preserves the original review evidence;
its baseline defects are historical findings, not a statement that the corrected client still has them.

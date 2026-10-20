# Adversarial client coverage and bug discovery

Baseline: master `5e5aa8fb8333332ce3ceacff933d1ed6f5cd28b8`, after PR #17. The aim was to
find incorrect public behavior in failure and recovery paths. Twelve new adversarial
regressions were observed failing before their corresponding fixes; ten additional protocol
tests check failure containment. The full suite grows from 38 to 60 tests per Node format.

## Reproduced failures and corrections

| Trigger | Incorrect behavior | Correction |
| --- | --- | --- |
| Transport loss with buffered LIB records | An orphaned block from the previous connection was later marked irreversible alongside its canonical replacement. | Invalidate old reversible data and replay from an inclusive recovery boundary. |
| Relay outage while the socket survives | The same stale-fork confirmation could occur across `relay_down`/`relay_restored`. | Use the same suspension and buffer invalidation for relay and transport outages. |
| Another disconnect before replay data arrives | The resume boundary advanced past unread records. | Preserve the active recovery boundary separately from delivery progress. |
| Old UUID packet during replacement setup | A record from the retired request could enter the recovering subscription and be confirmed. | Remove old replay subscription routing immediately on suspension. |
| Stop with queued iterator records | Existing iterators continued receiving cached data after explicit stop. | Discard queued records on stop; preserve draining after natural history completion. |
| Stop inside the first late message observer | Cached replay continued after the observer stopped its stream. | Stop replay when cancellation or failure occurs. |
| Remove a once observer using its original callback | The wrapped observer remained registered and fired. | Track wrappers so `off` recognizes the original callback. |
| Immediate retry after cancelling connection setup | The retry inherited the cancelled connection promise. | Clear state before callbacks and only clean up the connection attempt that owns it. |
| Optional numeric settings explicitly set to `undefined` | Valid optional settings replaced defaults and failed validation. | Resolve defaults before validating numeric limits. |
| Repeated LIB updates for one block | Duplicate blocks reset the stall timer and polluted its progress samples. | Only increasing block numbers count as progress. |
| LIB stalls after its first update | No watchdog existed until enough later updates arrived. | Arm the watchdog on the first valid update. |
| An async stream/client observer rejects | A rejected promise escaped as an unhandled rejection. | Capture synchronous and asynchronous observer failures without delaying transport acceptance; contain client error-observer failures. |

When replay is disabled, a LIB subscription with pending unconfirmed data now fails visibly
after an outage with retryable `STREAM_REPLAY_REQUIRED`. Retaining that data could confirm a
stale fork; silently dropping it could hide data loss. Replay-enabled recovery replaces it
from retained server history. Applications must still deduplicate and persist checkpoints.

## Measurement and acceptance

Native Node coverage measures the emitted core ESM runtime, including metadata and error
helpers. It excludes examples, tests, dependencies and generated browser/CommonJS bundles.
The complete public protocol suite also runs against CommonJS; browser results are separate.

| Native Node 24 measurement | Before | After |
| --- | ---: | ---: |
| Lines | 89.00% | 97.95% |
| Branches | 80.47% | 89.86% |
| Functions | 87.91% | 92.16% |

`npm test` builds every format and enforces core ESM minimums of 95% lines, 88% branches,
and 90% functions. CI runs those gates and the full CommonJS suite on Node 22/24 and
Windows/Linux. Local checks also cover external packed ESM/CommonJS runtime and TypeScript
consumers, whole-project typechecking, and six Chromium cases across ESM/UMD: history;
structured setup rejection plus malformed binary delivery; binary uint64 preservation plus
iterator cancellation. Consult the PR's exact-head CI results for platform acceptance.

Remaining gaps include real Hyperion/proxy integration, server retained-history and filter
correctness, long-running reconnect/retention soak, non-Chromium browsers, and full protocol
tests against an externally installed tarball (the tarball check currently tests construction
and types). The line percentage does not establish those properties. Server integration
remains tracked by [history-api #231](https://github.com/eosrio/hyperion-history-api/issues/231).

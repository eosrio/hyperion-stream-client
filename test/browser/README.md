# Browser acceptance

```sh
npm run build:all
npx playwright install chromium
npm run test:browser
```

The automated tests load the emitted ESM and UMD artifacts in real Chromium, connect to a
loopback Socket.IO server, request history, consume it, and verify iterator completion.
They use local dependency assets and do not contact public Hyperion endpoints or CDNs.

For manual import/construction checks, run `npm run serve:tests` and open:

- `/test/browser/import-map-esm-test.html`
- `/test/browser/umd-global-test.html`

These smoke pages create and cancel offline subscriptions. Passing them does not establish
connection or data delivery; use the automated protocol tests for that acceptance.

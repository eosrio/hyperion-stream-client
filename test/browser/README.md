# Hyperion Stream Client Test Files

This directory contains test files for verifying the functionality of the Hyperion Stream Client in different
environments and with different import methods.

## Test Files

### 1. UMD Global Test (`umd-global-test.html`)

This file tests the traditional UMD script with global access. It loads the UMD bundle directly via a script tag and
accesses the HyperionStreamClient globally.

```html

<script src="../../dist/hyperion-stream-client.js"></script>
<script>
    // Access globally
    const client = new HyperionStreamClient({...});
</script>
```

### 2. ESM Import Map Test (`import-map-esm-test.html`)

This file tests using the ESM module directly with import maps, including mapping all dependencies.

```html

<script type="importmap">
    {
        "imports": {
            "@eosrio/hyperion-stream-client": "../lib/esm/index.js",
            "socket.io-client": "https://cdn.jsdelivr.net/npm/socket.io-client@4.8.1/+esm",
            "async": "https://cdn.jsdelivr.net/npm/async@3.2.6/+esm"
        }
    }
</script>
<script type="module">
    import {HyperionStreamClient} from "@eosrio/hyperion-stream-client";

    const client = new HyperionStreamClient({...});
</script>
```

## Running the Tests

1. Start the test server:
   ```bash
   node test/browser/serve-tests.cjs
   ```

2. Open your browser and navigate to:
    - http://localhost:3001/ - Index page with links to all tests
    - http://localhost:3001/test/umd-global-test.html - UMD bundle with global access
    - http://localhost:3001/test/import-map-test.html - UMD bundle with import map
    - http://localhost:3001/test/import-map-default-test.html - UMD bundle with import map (default export)
    - http://localhost:3001/test/import-map-esm-test.html - ESM module with import map

3. Check the browser console to see if the imports and client creation were successful

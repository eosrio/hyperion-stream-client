# Hyperion Stream Client

A TypeScript/JavaScript client for streaming data from Hyperion History API (v3.6+).

> **Compatibility Note**: Hyperion Stream Client v3.6 is only compatible with Hyperion servers from v3.6 onwards.

## Installation

```bash
npm install @eosrio/hyperion-stream-client --save
```

## Supported Environments

- **Node.js** (v18+)
  - ES Modules: `import { HyperionStreamClient } from "@eosrio/hyperion-stream-client"`
  - CommonJS: `const { HyperionStreamClient } = require("@eosrio/hyperion-stream-client")`
- **Browsers**
  - ES Modules (Angular, React, Vue, etc.)
  - UMD bundle: 
    ```html
    <!-- From CDN (replace with your preferred CDN) -->
    <script src="https://unpkg.com/@eosrio/hyperion-stream-client/dist/hyperion-stream-client.js"></script>

    <!-- Or from local file -->
    <script src="path/to/hyperion-stream-client.js"></script>

    <!-- Usage after script is loaded -->
    <script>
      const client = new HyperionStreamClient({
        endpoint: "https://eos.hyperion.eosrio.io"
      });
    </script>
    ```
  - Import Maps (Modern browsers):
    ```html
    <!-- Import Map Definition - UMD Bundle Approach -->
    <script type="importmap">
    {
      "imports": {
        "@eosrio/hyperion-stream-client": "https://unpkg.com/@eosrio/hyperion-stream-client/dist/hyperion-stream-client.js"
      }
    }
    </script>

    <!-- Usage with import map -->
    <script type="module">
      import { HyperionStreamClient } from "@eosrio/hyperion-stream-client";

      const client = new HyperionStreamClient({
        endpoint: "https://eos.hyperion.eosrio.io"
      });
    </script>
    ```

    Alternatively, you can use the ESM module directly with import maps, but you'll need to map all dependencies:

    ```html
    <!-- Import Map Definition - ESM Module Approach -->
    <script type="importmap">
    {
      "imports": {
        "@eosrio/hyperion-stream-client": "https://unpkg.com/@eosrio/hyperion-stream-client/lib/esm/index.js",
        "socket.io-client": "https://cdn.jsdelivr.net/npm/socket.io-client@4.8.1/+esm",
        "async": "https://cdn.jsdelivr.net/npm/async@3.2.6/+esm",
        "cross-fetch": "https://cdn.jsdelivr.net/npm/cross-fetch@4.1.0/+esm"
      }
    }
    </script>
    ```

    > **Note on Browser Compatibility**: Import maps are supported in Chrome 89+, Edge 89+, Safari 16.4+, and Firefox 108+. For older browsers, you should use the UMD bundle with a regular script tag or consider using a polyfill like [es-module-shims](https://github.com/guybedford/es-module-shims).

## Basic Usage

```typescript
import { HyperionStreamClient } from "@eosrio/hyperion-stream-client";

// 1. Create client
const client = new HyperionStreamClient({
  endpoint: "https://eos.hyperion.eosrio.io",
  debug: false
});

// 2. Set up event handlers
client.on("connect", () => {
  console.log("Connected to Hyperion Stream API");
});

client.on("error", (error) => {
  console.error("Connection error:", error);
});

// 3. Connect to the endpoint
await client.connect();

// 4. Stream actions
const stream = await client.streamActions({
  contract: "eosio.token",
  action: "transfer",
  account: "",
  start_from: 0,
  filters: [
    { field: "@transfer.to", value: "eosio.ramfee" }
  ]
});

// 5. Handle stream data
stream.on("message", (data) => {
  console.log("Received transfer to eosio.ramfee:", data.content.act.data);
});
```

## Client Configuration

```typescript
const client = new HyperionStreamClient({
  // Required: Hyperion API endpoint
  endpoint: "https://eos.hyperion.eosrio.io",

  // Optional: Enable debug logging (default: false)
  debug: false,

  // Optional: Stream irreversible blocks only (default: false)
  libStream: false,

  // Optional: Monitor last irreversible block (default: false)
  libMonitor: false,

  // Optional: Connection timeout in ms (default: 5000)
  connectionTimeout: 5000
});
```

## Streaming Actions

```typescript
const stream = await client.streamActions({
  // Required: Contract account
  contract: "eosio.token",

  // Required: Action name (use "*" for all actions)
  action: "transfer",

  // Optional: Notified account (use "" for any)
  account: "",

  // Optional: Start block/time (0 = from HEAD, negative = blocks from HEAD)
  start_from: 0, // or "-100" or "2023-01-01T00:00:00.000Z"

  // Optional: End block/time (0 = no end)
  read_until: 0,

  // Optional: Data filters
  filters: [
    { field: "@transfer.to", value: "someaccount" }
  ]
});
```

## Streaming Table Deltas

```typescript
const deltaStream = await client.streamDeltas({
  // Required: Contract account
  code: "eosio.token",

  // Required: Table name (use "*" for all tables)
  table: "accounts",

  // Optional: Table scope (use "" for any)
  scope: "",

  // Optional: RAM payer (use "" for any)
  payer: "",

  // Optional: Start block/time
  start_from: 0,

  // Optional: End block/time (0 = no end)
  read_until: 0,

  // Optional: Filter operation type ('and' or 'or')
  filter_op: "or",

  // Optional: Data filters
  filters: [
    { field: "payer", value: "someaccount" },
    { field: "data.balance", value: "100.0000 EOS" }
  ]
});
```

## Event Handling

The client uses an event-based API:

```typescript
// Client events
client.on("connect", () => { /* ... */ });
client.on("error", (error) => { /* ... */ });
client.on("libUpdate", (data) => { /* ... */ });

// Stream events
stream.on("message", (data) => { /* ... */ });
stream.on("error", (error) => { /* ... */ });
```

## AsyncIterator Pattern

In addition to the event-based API, streams also support the AsyncIterator pattern, which allows for more readable, sequential processing of stream data:

```typescript
// Create a stream
const stream = await client.streamActions({
  contract: "eosio.token",
  action: "transfer"
});

// Process stream data using for-await-of loop
try {
  for await (const action of stream) {
    // Check for stream end
    if (action === null) break;

    // Process the action
    console.log(`Block ${action.content.block_num}: ${action.content.act.name}`);
  }
  console.log("Stream ended");
} catch (error) {
  console.error("Stream error:", error);
}
```

This pattern is especially useful for sequential processing and works with both action and delta streams.

## Block Range Parameters

### Understanding `start_from` and `read_until`

Both parameters accept three types of values:

- **Positive number**: Absolute block number
- **Negative number**: Relative number of blocks from the current head block
- **ISO timestamp string**: Specific point in time (e.g., "2023-01-01T00:00:00.000Z")

#### Examples:

```typescript
// Start from the current head block
start_from: 0

// Start from exactly block 150000000
start_from: 150000000

// Start from 100 blocks before the current head block
start_from: -100

// Start from January 1, 2023
start_from: "2023-01-01T00:00:00.000Z"

// Read until 200 blocks before the current head block
read_until: -200
```

For more advanced usage and complete examples, see the [examples directory](https://github.com/eosrio/hyperion-stream-client/tree/master/src/examples) in the repository.


## Additional Resources

- [Examples Directory](https://github.com/eosrio/hyperion-stream-client/tree/master/src/examples) - Complete example scripts
- [Socket.IO Load Balancing](https://socket.io/docs/v4/using-multiple-nodes/#NginX-configuration) - Information for production deployments
- [Hyperion API Documentation](https://hyperion.docs.eosrio.io/) - Full Hyperion API documentation

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build ESM version
npm run build:esm

# Build CommonJS version
npm run build:cjs

# Build browser bundle
npm run build:webpack

# Build all formats
npm run build:all
```

### Browser Tests

The repository includes test files to verify browser functionality:

1. Clone the repository and build all formats:
   ```bash
   git clone https://github.com/eosrio/hyperion-stream-client.git
   cd hyperion-stream-client
   npm install
   npm run build:all
   ```

2. Run the test server:
   ```bash
   npm run serve:tests
   ```
   or
   ```bash
   node test/browser/serve-tests.cjs
   ```

3. Open your browser and navigate to:
   - http://localhost:3001/ - Index page with links to all tests
   - http://localhost:3001/test/browser/umd-global-test.html - UMD bundle with global access
   - http://localhost:3001/test/browser/import-map-esm-test.html - ESM module with import map

4. Check the browser console to see if the imports and client creation were successful

The browser tests verify two main import methods:

- **UMD Global Test**: Tests loading the UMD bundle directly via a script tag and accessing the HyperionStreamClient globally
- **ESM Import Map Test**: Tests using the ESM module directly with import maps, including mapping all dependencies

### Running Tests

The library uses Node.js Native Test Runner (v18+):

```bash
# Run all tests
npm test

# Run specific test categories
npm run test:connection
npm run test:streaming
npm run test:error-handling
npm run test:api

# Run tests in watch mode
npm run test:watch
```

## License

MIT License - See [LICENSE](https://github.com/eosrio/hyperion-stream-client/blob/master/LICENSE) for details.

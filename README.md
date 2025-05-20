<br></br>
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://eosrio.io/hyperion-white.png">
    <img alt="Hyperion Logo"
         src="https://eosrio.io/hyperion.png">
  </picture>
</p>


<h4 align="center">
    A TypeScript/JavaScript client for streaming data from Hyperion History API (v3.6+)<br>
</h4>

<br>

<div align="center">

Made with ♥ by [Rio Blocks](https://rioblocks.io/?lang=en)
</div>

<div align="center">

### 📖 [Hyperion Docs - Official Stream Documentation](https://hyperion.docs.eosrio.io/dev/stream_client/)📖
</div>

# Hyperion Stream Client

A TypeScript/JavaScript client for effortlessly streaming real-time and historical data from Hyperion History API servers (v3.6+).

The Hyperion Stream Client simplifies connecting to and consuming data streams from Hyperion. It handles the underlying WebSocket communication, message parsing, and stream lifecycle management, allowing you to focus on building powerful applications with blockchain data.
> **Compatibility Note**: Hyperion Stream Client v3.6 is only compatible with Hyperion servers from v3.6 onwards.

## Key Features

*   **Stream Blockchain Data**: Subscribe to contract actions and table deltas.
*   **Powerful Filtering**: Precisely define the data you need with server-side filters.
*   **Flexible Data Consumption**:
    *   **Event-Driven API**: Use `on('message', ...)` for reactive data handling.
    *   **AsyncIterator Pattern**: Process data sequentially with `for await...of` loops.
*   **Versatile Block Ranges**: Specify `start_from` and `read_until` using block numbers, relative offsets (e.g., `-100` for 100 blocks from HEAD), or ISO timestamps.
*   **Irreversibility Focus**: Option to stream only irreversible blocks (`libStream`) or monitor the Last Irreversible Block (`libMonitor`).
*   **Broad Environment Support**:
    *   **Node.js (v18+)**: ES Modules and CommonJS.
    *   **Browsers**: ES Modules (for modern bundlers like Webpack, Rollup, Vite), UMD bundle (for direct `<script>` tag usage), and Import Maps.
*   **Automatic Reconnection**: Leverages socket.io-client's robust reconnection capabilities.
*   **Debug Mode**: Optional detailed logging for development.

## Table of Contents

- [Installation](#installation)
- [Supported Environments](#supported-environments)
    - [Node.js](#nodejs-v18)
    - [Browsers](#browsers)
- [Quick Start: Basic Usage](#getting-started-basic-usage)
- [Client Configuration](#client-configuration)
- [Streaming Actions](#streaming-actions)
- [Streaming Table Deltas](#streaming-table-deltas)
- [Event Handling](#event-handling)
    - [Client Events](#client-events)
    - [Stream Events](#stream-events)
- [AsyncIterator Pattern](#asynciterator-pattern)
- [Understanding Block Range Parameters (`start_from`, `read_until`)](#understanding-block-range-parameters-start_from-read_until)
- [Error Handling](#error-handling)
- [Additional Resources](#additional-resources)
- [Development](#development)
    - [Building from Source](#building-from-source)
    - [Running Tests](#running-tests)
    - [Browser Tests](#browser-tests)
- [License](#license)

## Installation

```bash
npm install @eosrio/hyperion-stream-client --save
```

## Supported Environments

### **Node.js** (v18+)

  - **ES Modules (Recommended):** 
    ```bash
    import { HyperionStreamClient } from "@eosrio/hyperion-stream-client"
    ```
    
  - **CommonJS:** 
    ```bash
    `const { HyperionStreamClient } = require("@eosrio/hyperion-stream-client")`
    ```
    
### **Browsers**
  - **ES Modules (with bundlers like Webpack, Rollup, Vite)**
    
    This is the standard approach for modern web applications (Angular, React, Vue, etc.).
      ```bash
      import { HyperionStreamClient } from "@eosrio/hyperion-stream-client"
      ```

  - **UMD bundle  (via `<script>` tag):**

    Load directly from a CDN or a local file.

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
    
  **- Import Maps (Modern browsers):**

  Allows using ES Module syntax with direct paths or CDN links.

1.  **Mapping the UMD bundle (simpler setup):**

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

2. **Mapping the ESM module directly (requires mapping dependencies):**

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
   

## Getting Started: Basic Usage

Here's a simple example to get you started with streaming:

```typescript
import { HyperionStreamClient } from "@eosrio/hyperion-stream-client";

// 1. Create client
const client = new HyperionStreamClient({
  endpoint: "https://eos.hyperion.eosrio.io", // Replace with your target Hyperion endpoint
  debug: false  // Set to true for verbose logging
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

### Understanding Stream Data
When you receive messages from a stream, the `data.content` object will contain the specific action or delta information. The structure of this content is defined by interfaces like `ActionContent` and `DeltaContent`.

- `ActionContent`: Contains details about an action trace, including `act` (with `account`, `name`, `data`, `authorization`), `block_num`, `trx_id`, `@timestamp`, etc.
- `DeltaContent`: Contains details about a table delta, including `code`, `table`, `scope`, `payer`, `primary_key`, `data` (the actual row data), `present` (1 for creation/update, 0 for deletion), `block_num`, `@timestamp`, etc.

The client automatically processes some metadata fields (e.g., `@transfer.data`) and merges them into the main `data` or `act.data` object for easier access.

## Client Configuration

When creating a `HyperionStreamClient` instance, you can pass the following options:

```typescript
const client = new HyperionStreamClient({
  // Required: Hyperion API endpoint
  // The client will automatically append '/stream' for WebSocket connections.
  endpoint: "https://eos.hyperion.eosrio.io",

  // Optional: Enable debug logging (default: false)
  debug: false, 
    
  // Optional: Stream irreversible blocks only (default: false)
  // This introduces latency but ensures fork-resistance. 
  libStream: false,

  // Optional: Monitor last irreversible block and emit 'libUpdate' events. (default: false)
  libMonitor: false,
    
  // Optional: Connection timeout in ms (default: 5000)
  connectionTimeout: 5000 
});
```

## Streaming Actions

Stream action traces filtered by contract, action name, and involved accounts.

```typescript
const stream = await client.streamActions({
  // Required: Contract account name
  contract: "eosio.token",
    
  // Required: Action name (use "*" for all actions from the contract)
  action: "transfer", 

  // Optional: An account name. If provided, only actions where this account is
  // listed in `act.authorization`, or is the receiver/sender (if applicable to the action),
  // or is listed in the `notified` array will be streamed.
  // Use "" (empty string) or omit to not filter by a specific account.
  account: "",

  // Optional: Start block/time (0 = from HEAD, negative = blocks from HEAD)
  start_from: 0, // or "-100" or "2023-01-01T00:00:00.000Z"

  // Optional: End block/time (0 = no end)
  read_until: 0,

  // Optional: If true, the stream will stop after processing historical data and will not send live blocks.
  // (default: false)
  ignore_live: false,   
    
  // Optional: If true, the stream will attempt to replay from the last received block upon reconnection.
  // (default: false, set to true for robust long-running streams)
  replayOnReconnect: false,

  // Optional: An array of filter objects to apply server-side filtering on action data.
  // Hyperion uses a dot-notation for nested fields (e.g., "act.data.to").
  // For action traces, common filterable fields are within `act.data`, `act.authorization`, etc.
  // Some fields might be auto-decoded by Hyperion (e.g., `@transfer.from`).
  filters: [
    { field: "@transfer.to", value: "someaccount" }
  ],

  // Optional: Logical operator for multiple filters ('and' or 'or'). (default: 'and')
  filter_op: "and"
});

// Then use actionStream.on('message', ...) or for await...of
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

  // Optional: If true, the stream will stop after processing historical data. (default: false)
  ignore_live: false,

  // Optional: Replay from last block on reconnect. (default: false)
  replayOnReconnect: true,

  // Optional: Filter operation type ('and' or 'or')
  filter_op: "or",

  // Optional: Data filters
  filters: [
    { field: "payer", value: "someaccount" },
    { field: "data.balance", value: "100.0000 EOS" }
  ],

  // Optional: Logical operator for multiple filters ('and' or 'or'). (default: 'and')
  filter_op: "or"
});

// Then use deltaStream.on('message', ...) or for await...of
```

## Event Handling

The client and streams use an event-based API:

### Client Events

Listen to events directly on the `client` instance:

- `client.on("connect", () => { ... })`: Fired when the WebSocket connection to Hyperion is successfully established. 
- `client.on("error", (error) => { ... })`: Fired on connection errors or other client-level issues. 
- `client.on("libUpdate", (data) => { ... })`: Fired when `libMonitor` is true, providing Last Irreversible Block updates ({ chain_id, block_num, block_id }). 
- `client.on("fork", (data) => { ... })`: Fired when a blockchain fork event is detected by Hyperion. 
- `client.on("data", (data) => { ... })`: Generic event for any data message from any stream (if not using libStream). 
- `client.on("libData", (data) => { ... })`: Generic event for irreversible data messages from any stream (if libStream is true).

```typescript
// Client events
client.on("connect", () => { /* ... */ });
client.on("error", (error) => { /* ... */ });
client.on("libUpdate", (data) => { /* ... */ });

// Stream events
stream.on("message", (data) => { /* ... */ });
stream.on("error", (error) => { /* ... */ });
```

### Stream Events

Listen to events on individual `actionStream` or `deltaStream` instances:

*   `stream.on("message", (data) => { ... })`: Fired for each action or delta received.
    *   `data.content`: The actual action or delta payload.
    *   `data.mode`: `"live"` or `"history"`.
    *   `data.type`: `"action"` or `"delta"`.
    *   `data.uuid`: The request UUID for this stream.
    *   `data.irreversible`: `true` if the data is irreversible (relevant if `client.options.libStream` is true).
*   `stream.on("error", (error) => { ... })`: Fired if an error occurs specific to this stream request (e.g., invalid parameters).
*   `stream.on("start", (response) => { ... })`: Fired when the stream is successfully initiated with the server. `response` contains `{ status: "OK", reqUUID: "...", startingBlock: ... }`.


## AsyncIterator Pattern

In addition to the event-based API, streams also support the AsyncIterator pattern, which allows for more readable, sequential processing of stream data, especially useful with `async/await`.

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

This pattern works for both `streamActions` and `streamDeltas`.

## Understanding Block Range Parameters (`start_from`, `read_until`)

Both `start_from` and `read_until` parameters in `streamActions` and `streamDeltas` requests accept three types of values to define the block range for your stream:

1.  **Positive Number (Absolute Block Number):**
    *   Represents a specific block number on the blockchain.
    *   Example: `start_from: 150000000` (starts streaming from block 150,000,000).


2.  **Negative Number (Relative to Head Block):**
    *   Represents an offset from the current head block of the chain.
    *   `0`: Represents the current head block.
    *   Example: `start_from: -100` (starts streaming from 100 blocks *before* the current head block).
    *   Example: `read_until: -50` (stops streaming 50 blocks *before* the current head block at the time of the request or when that condition is met for live streams).


3.  **ISO 8601 Timestamp String (Specific Point in Time):**
    *   Represents a specific date and time. Hyperion will find the block closest to this timestamp.
    *   Format: `YYYY-MM-DDTHH:mm:ss.sssZ` (milliseconds are optional, `Z` indicates UTC).
    *   Example: `start_from: "2023-01-01T00:00:00Z"` (starts streaming from the block produced at or just after midnight UTC on Jan 1, 2023).


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

## Error Handling

*   **Connection Errors:** Listen to `client.on('error', (err) => { ... });`. The `client.connect()` promise will also reject on initial connection failure.
*   **Stream Request Errors:** The `client.streamActions()` or `client.streamDeltas()` promises will reject if the initial request parameters are invalid or the server rejects the setup.
*   **In-Stream Errors:** Listen to `stream.on('error', (err) => { ... });` for errors that occur after a stream has started.
*   **AsyncIterator Errors:** Wrap your `for await...of` loop in a `try...catch` block.


## Additional Resources

- [Hyperion API Documentation](https://hyperion.docs.eosrio.io/) - Full Hyperion API documentation.
- [Examples Directory](https://github.com/eosrio/hyperion-stream-client/tree/master/src/examples) - Find more detailed usage examples in the repository.
- [Socket.IO Load Balancing](https://socket.io/docs/v4/using-multiple-nodes/#NginX-configuration) - Information for production deployments.


## Development

This section is for those looking to contribute to or build the `HyperionStreamClient` from source.


### Building from Source

1.  Clone the repository:
    ```bash
    git clone https://github.com/eosrio/hyperion-stream-client.git
    cd hyperion-stream-client
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Build commands:
    ```bash
    # Build ESM version (to ./lib/esm)
    npm run build:esm

    # Build CommonJS version (to ./lib/cjs)
    npm run build:cjs

    # Build browser UMD bundle (to ./dist)
    npm run build:webpack

    # Build all formats
    npm run build:all
    ```

### Running Tests

The library uses Node.js Native Test Runner (requires Node.js v18+).

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

### Browser Tests

Verify functionality in browser environments.

1.  Ensure you have built all formats: `npm run build:all`

2. Run the test server:
   ```bash
   npm run serve:tests
   ```
   or directly
   ```bash
   node test/browser/serve-tests.cjs
   ```

3. Open your browser and navigate to:
   - http://localhost:3001/ (Index page with links to tests)
   - http://localhost:3001/test/browser/umd-global-test.html (Tests UMD bundle global access)
   - http://localhost:3001/test/browser/import-map-esm-test.html (Tests ESM module via import map with dependencies mapped)

4.  Check the browser console for success messages or errors.

The browser tests verify two main import methods:

- **UMD Global Test**: Tests loading the UMD bundle directly via a script tag and accessing the HyperionStreamClient globally
- **ESM Import Map Test**: Tests using the ESM module directly with import maps, including mapping all dependencies

## License

This project is licensed under the MIT License - See [LICENSE](https://github.com/eosrio/hyperion-stream-client/blob/master/LICENSE) for details.

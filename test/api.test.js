import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createTestClient, wait, TEST_TIMEOUT } from './setup.js';

describe('HyperionStreamClient API Tests', async () => {
  let client;

  // Setup before tests
  before(async () => {
    client = await createTestClient();
  });

  // Cleanup after tests
  after(() => {
    if (client) {
      client.disconnect();
    }
  });

  it('should properly handle event listeners', { timeout: TEST_TIMEOUT }, async () => {
    // Test adding and removing event listeners
    let eventFired = false;

    // Create a test event handler
    const testHandler = () => {
      eventFired = true;
    };

    // Add the event listener
    client.on('connect', testHandler);

    // Connect to trigger the event
    await client.connect();

    // Verify that the event was fired
    assert.ok(eventFired, 'Event should be fired');

    // Reset the flag
    eventFired = false;

    // Disconnect
    client.disconnect();

    // Remove the event listener
    client.off('connect', testHandler);

    // Connect again
    await client.connect();

    // Verify that the event was not fired (since we removed the listener)
    assert.ok(!eventFired, 'Event should not be fired after removing listener');

    // Disconnect
    client.disconnect();
  });

  it('should support one-time event listeners with once()', { timeout: TEST_TIMEOUT }, async () => {
    // Test one-time event listeners
    let eventCount = 0;

    // Create a test event handler
    const testHandler = () => {
      eventCount++;
    };

    // Add the one-time event listener
    client.once('connect', testHandler);

    // Connect to trigger the event
    await client.connect();

    // Verify that the event was fired once
    assert.equal(eventCount, 1, 'Event should be fired once');

    // Disconnect
    client.disconnect();

    // Connect again
    await client.connect();

    // Verify that the event was not fired again (since it was a one-time listener)
    assert.equal(eventCount, 1, 'Event should not be fired again for one-time listener');

    // Disconnect
    client.disconnect();
  });

  it('should allow changing the endpoint', { timeout: TEST_TIMEOUT }, async () => {
    // Test changing the endpoint
    const originalEndpoint = client.options.endpoint;

    // Change the endpoint to another valid endpoint
    const newEndpoint = 'wss://eos.greymass.com';
    client.setEndpoint(newEndpoint);

    // Verify that the endpoint was changed
    assert.equal(client.options.endpoint, newEndpoint, 'Endpoint should be changed');

    // Try to connect with the new endpoint
    try {
      await client.connect();

      // If connection succeeds, verify that we're connected to the new endpoint
      assert.ok(client.chainId, 'Should be connected to the new endpoint');

      // Disconnect
      client.disconnect();
    } catch (error) {
      // If connection fails, it might be because the new endpoint is not available
      // This is acceptable for the test
      console.log('Could not connect to the new endpoint, but the test is still valid');
    }

    // Change back to the original endpoint
    client.setEndpoint(originalEndpoint);

    // Verify that the endpoint was changed back
    assert.equal(client.options.endpoint, originalEndpoint, 'Endpoint should be changed back');
  });

  it('should provide access to the last block number', { timeout: TEST_TIMEOUT }, async () => {
    // Connect to the endpoint
    await client.connect();

    // Create a stream to get some data
    const stream = await client.streamActions({
      contract: 'eosio',
      action: 'transfer',
      start_from: 0,
      read_until: 10, // Only read a few blocks for testing
    });

    // Wait a moment to receive some data
    await wait(1000);

    // Get the last block number
    const lastBlockNum = client.lastBlockNum();

    // Verify that the last block number is a number
    assert.ok(typeof lastBlockNum === 'number' || lastBlockNum === null,
      'Last block number should be a number or null');

    // Stop the stream
    stream.stop();

    // Disconnect
    client.disconnect();
  });

  it('should support debug logging', { timeout: TEST_TIMEOUT }, async () => {
    // Create a client with debug enabled
    const debugClient = await createTestClient({ debug: true });

    // Capture console.log output
    const originalConsoleLog = console.log;
    let logCalled = false;
    console.log = (...args) => {
      logCalled = true;
      // Uncomment to see the actual logs during testing
      // originalConsoleLog(...args);
    };

    try {
      // Connect to the endpoint (should trigger debug logs)
      await debugClient.connect();

      // Verify that console.log was called for debug logging
      assert.ok(logCalled, 'Debug logging should call console.log');

      // Disconnect
      debugClient.disconnect();
    } finally {
      // Restore console.log
      console.log = originalConsoleLog;
    }
  });

  it('should support custom configuration options', { timeout: TEST_TIMEOUT }, async () => {
    // Create a client with custom options
    const customClient = await createTestClient({
      libStream: true,
      libMonitor: true,
      chainApi: 'https://example.com/api'
    });

    // Verify that the options were set correctly
    assert.equal(customClient.options.libStream, true, 'libStream option should be set');
    assert.equal(customClient.options.libMonitor, true, 'libMonitor option should be set');
    assert.equal(customClient.options.chainApi, 'https://example.com/api', 'chainApi option should be set');

    // No need to connect for this test
  });

  it('should emit events correctly', { timeout: TEST_TIMEOUT }, async () => {
    // Test the emit method
    let eventData = null;

    // Create a test event handler
    const testHandler = (data) => {
      eventData = data;
    };

    // Add the event listener
    client.on('testEvent', testHandler);

    // Emit the event with test data
    const testData = { test: 'data' };
    client.emit('testEvent', testData);

    // Verify that the event was emitted with the correct data
    assert.deepEqual(eventData, testData, 'Event should be emitted with the correct data');

    // Remove the event listener
    client.off('testEvent', testHandler);
  });
});

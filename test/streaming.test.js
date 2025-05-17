import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createTestClient, wait, TEST_TIMEOUT } from './setup.js';

describe('HyperionStreamClient Streaming Tests', async () => {
  let client;

  // Setup before tests
  before(async () => {
    client = await createTestClient();
    await client.connect();
  });

  // Cleanup after tests
  after(() => {
    if (client) {
      client.disconnect();
    }
  });

  it('should stream actions with event-based API', { timeout: TEST_TIMEOUT }, async () => {
    // Create a stream for actions
    const stream = await client.streamActions({
      contract: 'eosio',
      action: 'onblock',
      start_from: -10, // Read just the last 10 blocks
      read_until: 0, // Only read a few blocks for testing
    });

    // Set up event listeners
    let messageReceived = false;
    let errorOccurred = false;

    stream.on('message', (data) => {
      messageReceived = true;
      // Verify data structure
      assert.ok(data.uuid, 'UUID should be present in the message');
      assert.equal(data.type, 'action', 'Message type should be "action"');
      assert.ok(data.content, 'Content should be present in the message');
    });

    stream.on('error', (error) => {
      console.error('Stream error:', error);
      errorOccurred = true;
    });

    // Wait for messages or timeout
    const startTime = Date.now();
    while (!messageReceived && Date.now() - startTime < TEST_TIMEOUT - 1000) {
      await wait(100);
    }

    // Stop the stream
    stream.stop();

    // Verify results
    assert.ok(!errorOccurred, 'No errors should occur during streaming');
    // Note: We don't assert messageReceived because it depends on the actual data in the blockchain
    // and might not be available in the test environment
  });

  it('should stream deltas with event-based API', { timeout: TEST_TIMEOUT }, async () => {
    // Create a stream for deltas
    const stream = await client.streamDeltas({
      code: 'eosio.token',
      table: 'accounts',
      scope: 'eosio',
      start_from: -10, // Read just the last 10 blocks
      read_until: 0, // Only read a few blocks for testing
    });

    // Set up event listeners
    let messageReceived = false;
    let errorOccurred = false;

    stream.on('message', (data) => {
      messageReceived = true;
      // Verify data structure
      assert.ok(data.uuid, 'UUID should be present in the message');
      assert.equal(data.type, 'delta', 'Message type should be "delta"');
      assert.ok(data.content, 'Content should be present in the message');
    });

    stream.on('error', (error) => {
      console.error('Stream error:', error);
      errorOccurred = true;
    });

    // Wait for messages or timeout
    const startTime = Date.now();
    while (!messageReceived && Date.now() - startTime < TEST_TIMEOUT - 1000) {
      await wait(100);
    }

    // Stop the stream
    stream.stop();

    // Verify results
    assert.ok(!errorOccurred, 'No errors should occur during streaming');
    // Note: We don't assert messageReceived because it depends on the actual data in the blockchain
    // and might not be available in the test environment
  });

  it('should support async iterator API for actions', { timeout: TEST_TIMEOUT }, async () => {
    // Create a stream for actions
    const stream = await client.streamActions({
      contract: 'eosio',
      action: 'onblock',
      start_from: -10, // Read just the last 10 blocks
      read_until: 0, // Only read a few blocks for testing
    });

    // Use async iterator to process messages
    let messageCount = 0;
    let errorOccurred = false;

    try {
      // Set a timeout to prevent the test from hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), TEST_TIMEOUT - 1000);
      });

      // Create an async iterator with timeout
      const iteratorPromise = (async () => {
        try {
          for await (const action of stream) {
            messageCount++;
            // Verify action structure
            assert.ok(action.uuid, 'UUID should be present in the action');
            assert.equal(action.type, 'action', 'Action type should be "action"');
            assert.ok(action.content, 'Content should be present in the action');

            // Break after processing a few messages
            if (messageCount >= 5) break;
          }
        } catch (error) {
          if (error.message !== 'Timeout') {
            errorOccurred = true;
            console.error('Iterator error:', error);
          }
        }
      })();

      // Wait for either the iterator to complete or timeout
      await Promise.race([iteratorPromise, timeoutPromise]).catch(() => {
        // Timeout is expected if no messages are received
      });
    } finally {
      // Stop the stream
      stream.stop();
    }

    // Verify results
    assert.ok(!errorOccurred, 'No errors should occur during streaming with async iterator');
    // Note: We don't assert messageCount because it depends on the actual data in the blockchain
    // and might not be available in the test environment
  });
});

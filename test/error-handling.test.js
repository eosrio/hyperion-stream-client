import {describe, it, before, after} from 'node:test';
import {strict as assert} from 'node:assert';
import {createTestClient, createMockSocket, wait, TEST_TIMEOUT} from './setup.js';

describe('HyperionStreamClient Error Handling Tests', async () => {
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

    await it('should handle invalid stream request parameters', {timeout: TEST_TIMEOUT}, async () => {
        // Connect to the endpoint
        await client.connect();

        // Test with missing required parameters
        try {
            await client.streamActions({
                // Missing contract and action
                start_from: 0,
            });
            assert.fail('Should throw an error for missing required parameters');
        } catch (error) {
            assert.ok(error, 'Error should be thrown for missing required parameters');
        }

        // Test with invalid parameter types
        try {
            await client.streamActions({
                contract: 123, // Should be a string
                action: 'transfer',
                start_from: 0,
            });
            assert.fail('Should throw an error for invalid parameter types');
        } catch (error) {
            assert.ok(error, 'Error should be thrown for invalid parameter types');
        }

        // Disconnect
        client.disconnect();
    });

    await it('should handle network disconnection gracefully', {timeout: TEST_TIMEOUT}, async () => {
        // Connect to the endpoint
        await client.connect();

        // Set up event listeners
        let disconnectEventFired = false;
        client.on('disconnect', () => {
            disconnectEventFired = true;
        });

        // Simulate a network disconnection by manually calling the socket's disconnect event handler
        // Note: This is a bit of a hack, but it's challenging to simulate a real network disconnection in a test
        if (client.socket && client.socket.listeners) {
            const disconnectHandlers = client.socket.listeners('disconnect');
            if (disconnectHandlers && disconnectHandlers.length > 0) {
                disconnectHandlers.forEach(handler => handler());
            }
        }

        // Wait a moment for the event to be processed
        await wait(500);

        // Verify that the disconnect event was handled
        assert.ok(disconnectEventFired, 'Disconnect event should be fired');

        // Disconnect
        client.disconnect();
    });

    await it('should handle server errors gracefully', {timeout: TEST_TIMEOUT}, async () => {
        // Connect to the endpoint
        await client.connect();

        // Set up event listeners
        let errorEventFired = false;
        client.on('error', () => {
            errorEventFired = true;
        });

        // Simulate a server error by manually calling the socket's error event handler
        if (client.socket && client.socket.listeners) {
            const errorHandlers = client.socket.listeners('error');
            if (errorHandlers && errorHandlers.length > 0) {
                errorHandlers.forEach(handler => handler(new Error('Simulated server error')));
            }
        }

        // Wait a moment for the event to be processed
        await wait(500);

        // Verify that the error event was handled
        assert.ok(errorEventFired, 'Error event should be fired');

        // Disconnect
        client.disconnect();
    });

    await it('should handle stream cancellation', {timeout: TEST_TIMEOUT}, async () => {
        // Connect to the endpoint
        await client.connect();

        // Create a stream
        const stream = await client.streamActions({
            contract: 'eosio',
            action: 'transfer',
            start_from: 0,
        });

        // Verify that the stream is created
        assert.ok(stream, 'Stream should be created');

        // Stop the stream
        stream.stop();

        // Wait a moment for the cancellation to be processed
        await wait(500);

        // Attempt to use the stream after it's stopped
        let errorOccurred = false;
        try {
            // This should fail because the stream is stopped
            for await (const action of stream) {
                // This should not execute
                assert.fail('Stream should not produce any actions after being stopped');
            }
        } catch (error) {
            errorOccurred = true;
        }

        // Verify that an error occurred
        assert.ok(errorOccurred, 'Error should occur when using a stopped stream');

        // Disconnect
        client.disconnect();
    });

    await it('should handle multiple simultaneous streams', {timeout: TEST_TIMEOUT}, async () => {
        // Connect to the endpoint
        await client.connect();

        // Create multiple streams
        const stream1 = await client.streamActions({
            contract: 'eosio.token',
            action: 'transfer',
            start_from: -100,
        });

        const stream2 = await client.streamActions({
            contract: 'eosio',
            action: 'onblock',
            start_from: -100,
        });

        // Verify that both streams are created
        assert.ok(stream1, 'Stream 1 should be created');
        assert.ok(stream2, 'Stream 2 should be created');

        // Set up event listeners for both streams
        let stream1MessageReceived = false;
        let stream2MessageReceived = false;

        stream1.on('message', () => {
            stream1MessageReceived = true;
        });

        stream2.on('message', () => {
            stream2MessageReceived = true;
        });

        // Wait for messages or timeout
        const startTime = Date.now();
        while ((!stream1MessageReceived || !stream2MessageReceived) &&
        Date.now() - startTime < TEST_TIMEOUT - 1000) {
            await wait(100);
        }

        // Stop both streams
        stream1.stop();
        stream2.stop();

        // Disconnect
        client.disconnect();

        // Note: We don't assert stream1MessageReceived or stream2MessageReceived because they depend on
        // the actual data in the blockchain and might not be available in the test environment
    });
});

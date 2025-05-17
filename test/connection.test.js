import {describe, it, before, after} from 'node:test';
import {strict as assert} from 'node:assert';
import {createTestClient, TEST_ENDPOINT, wait, TEST_TIMEOUT} from './setup.js';

describe('HyperionStreamClient Connection Tests', async () => {
    let client;

    // Setup before tests
    before(async () => {
        client = await createTestClient();
    });

    // Cleanup after tests
    after(() => {
        if (client) {
            console.log('Disconnecting client...');
            client.disconnect();
        }
    });

    await it('should connect to a Hyperion endpoint', {timeout: TEST_TIMEOUT}, async () => {
        // Set up event listeners
        let errorOccurred = false;
        client.on('error', (error) => {
            console.error('Connection error:', error);
        });

        // Connect to the endpoint
        await client.connect();

        // Verify connection
        assert.ok(client.chainId, 'Chain ID should be available after connection');
        assert.ok(!errorOccurred, 'No errors should occur during connection');

        // Disconnect
        client.disconnect();
    });

    await it('should handle connection errors gracefully', {timeout: TEST_TIMEOUT}, async () => {
        // Create a client with an invalid endpoint
        const invalidClient = createTestClient({endpoint: 'wss://invalid-endpoint.example'});

        // Set up event listeners
        let errorOccurred = false;
        invalidClient.on('error', (error) => {
            console.error('Connection error:', error.message);
            errorOccurred = true;
        });

        try {
            // Attempt to connect (should fail)
            await invalidClient.connect();
            assert.fail('Connection should have failed');
        } catch (error) {
            // Connection should fail
            assert.ok(errorOccurred || error, 'Error should be emitted or thrown');
        } finally {
            // Cleanup
            invalidClient.disconnect();
        }
    });

    await it('should reconnect after disconnection', {timeout: TEST_TIMEOUT}, async () => {
        // Connect to the endpoint
        await client.connect();

        // Verify initial connection
        const initialChainId = client.chainId;
        assert.ok(initialChainId, 'Chain ID should be available after initial connection');

        // Disconnect
        client.disconnect();

        // Wait a moment
        await wait(500);

        // Reconnect
        await client.connect();

        // Verify reconnection
        assert.equal(client.chainId, initialChainId, 'Chain ID should be the same after reconnection');

        // Disconnect
        client.disconnect();
    });

    await it('should timeout after specified connection timeout', {timeout: 10000}, async () => {
        // Create a client with a non-responsive endpoint and a short timeout
        const timeoutClient = createTestClient({
            endpoint: 'wss://example.com:12345', // Non-responsive endpoint
            connectionTimeout: 1000 // 1 second timeout
        });

        const startTime = Date.now();

        try {
            // Attempt to connect (should timeout)
            await timeoutClient.connect();
            assert.fail('Connection should have timed out');
        } catch (error) {
            // Connection should timeout
            const elapsedTime = Date.now() - startTime;

            // Verify that an error occurred
            assert.ok(error, `A connection error should have been thrown`);

            // Verify the timeout duration (with some tolerance)
            assert.ok(elapsedTime >= 1000 && elapsedTime < 3000,
                `Connection should timeout after ~1000ms, took ${elapsedTime}ms`);
        } finally {
            // Cleanup
            timeoutClient.disconnect();
        }
    });
});

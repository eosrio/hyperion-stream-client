// Common test utilities and configurations for Node.js Native Test Runner tests

// Mock endpoint for testing
import {HyperionStreamClient} from "../lib/esm/index.js";

export const TEST_ENDPOINT = 'wss://libre.rioblocks.io';

// Timeout for async tests (in milliseconds)
export const TEST_TIMEOUT = 5000;

// Helper function to create a test client
export function createTestClient(options = {}) {
    return new HyperionStreamClient({
        endpoint: TEST_ENDPOINT,
        debug: true,
        libStream: false,
        libMonitor: false,
        ...options
    });
}

// Helper function to wait for a specified time
export function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to create a mock socket for testing without actual connection
export function createMockSocket() {
    const events = {};

    return {
        on: (event, callback) => {
            events[event] = events[event] || [];
            events[event].push(callback);
            return this;
        },
        emit: (event, ...args) => {
            if (events[event]) {
                events[event].forEach(callback => callback(...args));
            }
            return this;
        },
        off: (event, callback) => {
            if (events[event]) {
                events[event] = events[event].filter(cb => cb !== callback);
            }
            return this;
        },
        disconnect: () => {
        },
        connected: true
    };
}

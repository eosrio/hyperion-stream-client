// Main test file for running all tests with Node.js Native Test Runner

// This file serves as an entry point for running all tests
// It doesn't contain any tests itself, but importing it will run all tests

// Import all test files
import './connection.test.js';
import './streaming.test.js';
import './error-handling.test.js';
import './api.test.js';

console.log('Running all Hyperion Stream Client tests...');

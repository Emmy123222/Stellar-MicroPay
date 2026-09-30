/**
 * Jest setup file
 * Sets up test environment before running tests
 */

// Set required environment variables for tests
process.env.JWT_SECRET = "test-secret-key-for-jest-tests-only-not-for-production";
process.env.STELLAR_NETWORK = "testnet";
process.env.ALLOWED_ORIGINS = "http://localhost:3000";

'use strict';

/**
 * Jest-specific setup for integration tests.
 *
 * Mocks infrastructure modules (DB pool, Redis, Socket.io handlers, cron)
 * so the Express app can be imported and tested with supertest without
 * requiring live database or Redis connections.
 */

// ─── Environment variables for test ──────────────────────────────────────────

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-jest';
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // let OS pick a free port

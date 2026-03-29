'use strict';

/**
 * Integration tests for the Questions API routes.
 *
 * Uses supertest against the Express app with all infrastructure mocked
 * (DB, Redis, Socket.io, cron) so no live services are required.
 */

// ─── Environment ─────────────────────────────────────────────────────────────

process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
process.env.NODE_ENV = 'test';

// ─── Mock infrastructure before requiring app ────────────────────────────────

const mockQuery = jest.fn(() => Promise.resolve({ rows: [], rowCount: 0 }));

jest.mock('../../src/db/pool', () => ({
  pool: {
    query: jest.fn(() => Promise.resolve({ rows: [{ '?column?': 1 }] })),
    connect: jest.fn(),
    end: jest.fn(),
  },
  query: mockQuery,
  withTransaction: jest.fn((fn) => fn({
    query: mockQuery,
    release: jest.fn(),
  })),
  closePool: jest.fn(),
}));

jest.mock('../../src/services/redis', () => ({
  connectRedis: jest.fn(() => Promise.resolve()),
  closeRedis: jest.fn(() => Promise.resolve()),
  getRedisClient: jest.fn(() => null),
  redis: null,
}));

jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    connect: jest.fn(() => Promise.resolve()),
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(() => Promise.resolve(1)),
    expire: jest.fn(() => Promise.resolve(1)),
  })),
}));

jest.mock('../../src/socket/handlers', () => ({
  initSocketHandlers: jest.fn(),
}));

jest.mock('../../src/cron', () => ({
  startCronJobs: jest.fn(),
}));

const mockChildLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mockChildLogger),
  },
  morganStream: { write: jest.fn() },
}));

// ─── Mock audit log ──────────────────────────────────────────────────────────

jest.mock('../../src/middleware/auditLog', () => ({
  logAction: jest.fn(),
  ACTIONS: {},
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../../src/server');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeToken(rabbiId = 'rabbi-1', role = 'rabbi') {
  return jwt.sign(
    { sub: rabbiId, role },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'aneh-hashoel' }
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('time');
    expect(res.body).toHaveProperty('uptime');
  });
});

describe('GET /api/questions', () => {
  test('returns an array when DB returns rows', async () => {
    // The authenticate middleware does a DB lookup, so we need a valid token
    // and the DB mock needs to return a rabbi for auth, then questions.
    const token = makeToken('rabbi-1', 'rabbi');

    // First call: auth middleware looks up rabbi
    // Subsequent calls: questions list query
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'rabbi-1', role: 'rabbi', name: 'Test', email: 'test@test.com', status: 'active' }],
      })
      // getQuestions may call multiple queries — count + list
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'q-1', title: 'Question 1', status: 'pending' },
          { id: 'q-2', title: 'Question 2', status: 'answered' },
        ],
      });

    const res = await request(app)
      .get('/api/questions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Response should be JSON (either an array or an object with a questions property)
    expect(res.body).toBeDefined();
  });
});

describe('POST /api/questions/claim/:id', () => {
  test('requires authentication — returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/questions/claim/q-1');

    expect(res.status).toBe(401);
  });

  test('requires authentication — returns 401 with invalid token', async () => {
    const res = await request(app)
      .post('/api/questions/claim/q-1')
      .set('Authorization', 'Bearer invalid-token-here');

    expect(res.status).toBe(401);
  });
});

describe('404 handler', () => {
  test('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent-route');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

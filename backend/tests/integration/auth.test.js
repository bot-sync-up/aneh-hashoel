'use strict';

/**
 * Integration tests for the Auth API routes (/api/auth).
 *
 * Uses supertest against the Express app with all infrastructure mocked.
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

// Mock the legacy auth service — loginWithEmail is called by the /login route
jest.mock('../../src/services/auth', () => ({
  loginWithEmail: jest.fn(),
  setup2FA: jest.fn(),
  verify2FA: jest.fn(),
  check2FA: jest.fn(),
  disable2FA: jest.fn(),
}));

// Mock the authService — loginRabbi is called after credential validation
jest.mock('../../src/services/authService', () => ({
  loginRabbi: jest.fn(),
  createTokens: jest.fn(),
  refreshTokens: jest.fn(),
  handleGoogleOAuth: jest.fn(),
  sendPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  validatePasswordPolicy: jest.fn(() => ({ valid: true })),
  detectNewDevice: jest.fn(() => Promise.resolve(false)),
  revokeSession: jest.fn(),
  revokeSessionByTokenHash: jest.fn(),
  revokeAllSessions: jest.fn(),
  listActiveSessions: jest.fn(() => Promise.resolve([])),
  getSessionById: jest.fn(),
  updateLastLogin: jest.fn(() => Promise.resolve()),
  hashToken: jest.fn((t) => t),
  BCRYPT_ROUNDS: 4,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../../src/server');
const legacyAuth = require('../../src/services/auth');
const authService = require('../../src/services/authService');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  test('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'somePass123' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rabbi@test.com' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when both fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns error for invalid credentials', async () => {
    // loginWithEmail throws for bad credentials
    legacyAuth.loginWithEmail.mockRejectedValueOnce(
      Object.assign(new Error('אימייל או סיסמה שגויים'), { status: 401 })
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrong@test.com', password: 'wrongPass' });

    // The error handler returns the error status
    expect([400, 401, 500]).toContain(res.status);
  });

  test('returns tokens for valid credentials', async () => {
    const mockRabbi = {
      id: 'rabbi-1',
      email: 'rabbi@test.com',
      name: 'Test Rabbi',
      role: 'rabbi',
      two_fa_enabled: false,
      must_change_password: false,
    };

    legacyAuth.loginWithEmail.mockResolvedValueOnce(mockRabbi);

    authService.loginRabbi.mockResolvedValueOnce({
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
      sessionId: 'session-1',
      rabbi: mockRabbi,
      isNewDevice: false,
    });

    // DB lookup for full profile
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'rabbi-1',
        email: 'rabbi@test.com',
        name: 'Test Rabbi',
        role: 'rabbi',
        signature: null,
        photo_url: null,
        is_vacation: false,
        must_change_password: false,
        notification_pref: null,
        whatsapp_number: null,
        two_fa_enabled: false,
        last_login: null,
        status: 'active',
      }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rabbi@test.com', password: 'ValidPass1!' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('rabbi');
  });
});

describe('Protected routes without token', () => {
  test('GET /api/auth/me returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/auth/change-password returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'old', newPassword: 'new' });

    expect(res.status).toBe(401);
  });

  test('POST /api/auth/logout-all returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/auth/logout-all');

    expect(res.status).toBe(401);
  });

  test('GET /api/auth/sessions returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/sessions');

    expect(res.status).toBe(401);
  });
});

describe('Protected routes with invalid token', () => {
  test('GET /api/auth/me returns 401 with expired token', async () => {
    const expiredToken = jwt.sign(
      { sub: 'rabbi-1', role: 'rabbi' },
      process.env.JWT_SECRET,
      { expiresIn: '0s', issuer: 'aneh-hashoel' }
    );

    // Wait a tick so the token is actually expired
    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me returns 401 with wrong secret', async () => {
    const badToken = jwt.sign(
      { sub: 'rabbi-1', role: 'rabbi' },
      'wrong-secret',
      { expiresIn: '1h', issuer: 'aneh-hashoel' }
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${badToken}`);

    expect(res.status).toBe(401);
  });
});

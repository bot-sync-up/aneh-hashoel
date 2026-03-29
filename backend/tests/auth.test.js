'use strict';

/**
 * Integration Tests — Auth Endpoints (/api/auth)
 *
 * Requires a running server (npm run dev) and access to the database.
 * Run with: npm test
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  createTestRabbi,
  request,
  cleanup,
  checkServer,
  TEST_PASSWORD,
} = require('./setup');

let testRabbi;
let testToken;

before(async () => {
  const alive = await checkServer();
  if (!alive) {
    console.error(
      '\n  Server is not reachable. Start the server first:\n' +
      '    cd backend && npm run dev\n'
    );
    process.exit(1);
  }
  const result = await createTestRabbi({ role: 'rabbi' });
  testRabbi = result.rabbi;
  testToken = result.accessToken;
});

after(async () => {
  await cleanup();
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('should login with valid credentials', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: testRabbi.email, password: TEST_PASSWORD },
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken, 'should return accessToken');
    assert.ok(res.body.rabbi, 'should return rabbi profile');
    assert.equal(res.body.rabbi.email, testRabbi.email);
  });

  it('should reject missing email', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { password: TEST_PASSWORD },
    });

    assert.ok([400, 401, 422].includes(res.status), `expected 4xx, got ${res.status}`);
    assert.ok(res.body.error, 'should return error message');
  });

  it('should reject missing password', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: testRabbi.email },
    });

    assert.ok([400, 401, 422].includes(res.status), `expected 4xx, got ${res.status}`);
    assert.ok(res.body.error, 'should return error message');
  });

  it('should reject wrong password', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: testRabbi.email, password: 'WrongPass1!' },
    });

    assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
    assert.ok(res.body.error, 'should return error message');
  });

  it('should reject non-existent email', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'nonexistent@nowhere.test', password: TEST_PASSWORD },
    });

    assert.ok([401, 404].includes(res.status), `expected 401/404, got ${res.status}`);
    assert.ok(res.body.error, 'should return error message');
  });
});

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────

describe('POST /api/auth/refresh', () => {
  it('should reject when no refresh token is provided', async () => {
    const res = await request('POST', '/api/auth/refresh', { body: {} });

    assert.ok([400, 401].includes(res.status), `expected 4xx, got ${res.status}`);
  });

  it('should reject an invalid refresh token', async () => {
    const res = await request('POST', '/api/auth/refresh', {
      body: { refreshToken: 'invalid-token-value' },
    });

    assert.ok([400, 401, 403].includes(res.status), `expected 4xx, got ${res.status}`);
  });

  it('should refresh with valid refresh token from login', async () => {
    // First, login to get a real refresh token
    const loginRes = await request('POST', '/api/auth/login', {
      body: { email: testRabbi.email, password: TEST_PASSWORD },
    });

    if (loginRes.status !== 200 || !loginRes.body.refreshToken) {
      // Skip if login didn't return refreshToken (e.g. 2FA enabled)
      return;
    }

    const res = await request('POST', '/api/auth/refresh', {
      body: { refreshToken: loginRes.body.refreshToken },
    });

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.accessToken, 'should return new accessToken');
  });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('should return current rabbi profile with valid token', async () => {
    const res = await request('GET', '/api/auth/me', { token: testToken });

    assert.equal(res.status, 200);
    assert.ok(res.body.rabbi, 'should return rabbi object');
    assert.equal(res.body.rabbi.id, testRabbi.id);
    assert.equal(res.body.rabbi.email, testRabbi.email);
  });

  it('should reject request without token', async () => {
    const res = await request('GET', '/api/auth/me');

    assert.equal(res.status, 401);
    assert.ok(res.body.error, 'should return error message');
  });

  it('should reject request with invalid token', async () => {
    const res = await request('GET', '/api/auth/me', {
      token: 'invalid.jwt.token',
    });

    assert.equal(res.status, 401);
  });

  it('should reject request with expired token', async () => {
    const jwt = require('jsonwebtoken');
    const expiredToken = jwt.sign(
      { sub: String(testRabbi.id), role: 'rabbi' },
      process.env.JWT_SECRET,
      { expiresIn: '0s', issuer: 'aneh-hashoel' }
    );

    // Small delay to ensure expiration
    await new Promise((r) => setTimeout(r, 100));

    const res = await request('GET', '/api/auth/me', { token: expiredToken });

    assert.equal(res.status, 401);
  });
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('should logout successfully', async () => {
    const res = await request('POST', '/api/auth/logout', { body: {} });

    assert.equal(res.status, 200);
    assert.ok(res.body.message, 'should return success message');
  });
});

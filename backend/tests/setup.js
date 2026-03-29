'use strict';

/**
 * Test Setup — shared helpers for integration tests.
 *
 * Tests run against a live server instance (default: http://localhost:3001).
 * Set TEST_BASE_URL to override.
 *
 * Provides:
 *   - getPool()            – pg Pool for direct DB access
 *   - createTestRabbi()    – insert a test rabbi, return { rabbi, accessToken }
 *   - request(method, path, opts) – HTTP helper
 *   - cleanup()            – remove test data and close pool
 */

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Load .env from backend root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Defaults
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
}

// ─── Pool access (direct DB, not through the server) ─────────────────────────

const { Pool } = require('pg');

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgres://postgres:@localhost:5432/aneh_hashoel',
      max: 3,
      idleTimeoutMillis: 5000,
    });
  }
  return _pool;
}

/**
 * Execute a query against the test pool.
 */
async function dbQuery(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

// ─── Test rabbi creation ─────────────────────────────────────────────────────

const TEST_EMAIL_PREFIX = 'test_integration_';
const TEST_PASSWORD = 'TestPass1!';
let _testCounter = 0;

/**
 * Create a test rabbi directly in the DB.
 * Returns { rabbi: { id, email, name, role }, accessToken, password }.
 */
async function createTestRabbi(opts = {}) {
  _testCounter++;

  const email = opts.email || `${TEST_EMAIL_PREFIX}${Date.now()}_${_testCounter}@test.local`;
  const name = opts.name || `Test Rabbi ${_testCounter}`;
  const role = opts.role || 'rabbi';
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4); // fast rounds for tests

  const { rows } = await dbQuery(
    `INSERT INTO rabbis (email, name, role, password_hash, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, true, NOW(), NOW())
     RETURNING id, email, name, role`,
    [email, name, role, passwordHash]
  );

  const rabbi = rows[0];

  // Sign an access token matching the server's JWT_SECRET
  const accessToken = jwt.sign(
    { sub: String(rabbi.id), role: rabbi.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'aneh-hashoel' }
  );

  return { rabbi, accessToken, password: TEST_PASSWORD };
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

/**
 * Lightweight HTTP request helper.
 *
 * @param {string} method  GET, POST, PUT, DELETE, PATCH
 * @param {string} urlPath e.g. '/api/auth/me'
 * @param {object} opts    { body?, token?, headers?, cookies? }
 * @returns {Promise<{ status: number, body: any, headers: object }>}
 */
async function request(method, urlPath, opts = {}) {
  const url = new URL(urlPath, BASE_URL);

  const headers = {
    'Content-Type': 'application/json',
    ...opts.headers,
  };

  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }

  if (opts.cookies) {
    headers['Cookie'] = opts.cookies;
  }

  const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({
            status: res.statusCode,
            body: parsed,
            headers: res.headers,
          });
        });
      }
    );

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Remove all test data and close the test pool.
 */
async function cleanup() {
  try {
    // Clean up test rabbis (cascading deletes should handle related rows)
    // Clean in order to respect foreign keys
    await dbQuery(
      `DELETE FROM sessions WHERE rabbi_id IN (SELECT id FROM rabbis WHERE email LIKE $1)`,
      [`${TEST_EMAIL_PREFIX}%`]
    ).catch(() => {});

    await dbQuery(
      `DELETE FROM refresh_tokens WHERE rabbi_id IN (SELECT id FROM rabbis WHERE email LIKE $1)`,
      [`${TEST_EMAIL_PREFIX}%`]
    ).catch(() => {});

    await dbQuery(
      `DELETE FROM discussion_members WHERE rabbi_id IN (SELECT id FROM rabbis WHERE email LIKE $1)`,
      [`${TEST_EMAIL_PREFIX}%`]
    ).catch(() => {});

    await dbQuery(
      `DELETE FROM discussion_messages WHERE rabbi_id IN (SELECT id FROM rabbis WHERE email LIKE $1)`,
      [`${TEST_EMAIL_PREFIX}%`]
    ).catch(() => {});

    // Delete test questions (identified by high wp_post_id range used in tests)
    await dbQuery(
      `DELETE FROM answers WHERE question_id IN (SELECT id FROM questions WHERE wp_post_id >= 900000000)`
    ).catch(() => {});

    await dbQuery(
      `DELETE FROM questions WHERE wp_post_id >= 900000000`
    ).catch(() => {});

    // Delete test discussions created by test rabbis
    await dbQuery(
      `DELETE FROM discussions WHERE created_by IN (SELECT id FROM rabbis WHERE email LIKE $1)`,
      [`${TEST_EMAIL_PREFIX}%`]
    ).catch(() => {});

    // Finally delete the test rabbis
    await dbQuery(
      `DELETE FROM rabbis WHERE email LIKE $1`,
      [`${TEST_EMAIL_PREFIX}%`]
    );
  } catch (err) {
    console.error('[test cleanup] Error:', err.message);
  }

  if (_pool) {
    await _pool.end().catch(() => {});
    _pool = null;
  }
}

/**
 * Create a test question directly in the DB.
 * The questions table requires wp_post_id (unique int) and title.
 */
async function createTestQuestion(opts = {}) {
  const status = opts.status || 'pending';
  const assignedRabbiId = opts.assignedRabbiId || null;
  // Generate a unique wp_post_id using timestamp + counter
  const wpPostId = opts.wpPostId || (900000000 + Date.now() % 100000000 + (++_testCounter));

  const { rows } = await dbQuery(
    `INSERT INTO questions (wp_post_id, title, content, status, assigned_rabbi_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING id, wp_post_id, title, content, status, assigned_rabbi_id`,
    [
      wpPostId,
      opts.title || 'Test Question Title',
      opts.content || 'This is a test question for integration tests?',
      status,
      assignedRabbiId,
    ]
  );

  return rows[0];
}

/**
 * Check if the server is reachable.
 */
async function checkServer() {
  try {
    const res = await request('GET', '/health');
    return res.status === 200;
  } catch {
    return false;
  }
}

module.exports = {
  getPool,
  dbQuery,
  createTestRabbi,
  createTestQuestion,
  request,
  cleanup,
  checkServer,
  TEST_PASSWORD,
  TEST_EMAIL_PREFIX,
  BASE_URL,
};

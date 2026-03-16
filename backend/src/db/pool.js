'use strict';

/**
 * PostgreSQL connection pool
 * Reads DATABASE_URL from the environment (plus optional tuning variables).
 * A single pool instance is created and reused across the application.
 */

const { Pool } = require('pg');

// ─── Pool configuration ────────────────────────────────────────────────────────

if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('[pool] DATABASE_URL environment variable is required in production.');
}

const poolConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:@localhost:5432/aneh_hashoel',

  // Connection pool sizing
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),

  // Milliseconds a client can sit idle before being closed
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),

  // Milliseconds to wait for a connection before throwing
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000', 10),

  // Keep connections alive at the TCP level
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,

  // SSL — set DB_SSL=true in production; pass DB_SSL_REJECT_UNAUTHORIZED=false
  // only when connecting to self-signed certs (staging / internal environments).
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
};

// ─── Pool instance ─────────────────────────────────────────────────────────────

const pool = new Pool(poolConfig);

// ─── Event handlers ────────────────────────────────────────────────────────────

pool.on('connect', (client) => {
  // Enforce UTC for every new connection so timestamps are always consistent.
  client.query("SET timezone = 'UTC'").catch((err) => {
    console.error('[pool] Failed to set timezone on new client:', err.message);
  });
});

pool.on('error', (err) => {
  // Log unexpected idle-client errors without crashing; the pool removes the
  // broken client automatically.
  console.error('[pool] Unexpected error on idle client:', err.message);
});

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Execute a single parameterised query.
 *
 * @param {string}   text    SQL statement
 * @param {Array}   [params] Positional parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    if (process.env.DB_LOG_QUERIES === 'true') {
      console.debug(
        `[pool] query (${Date.now() - start}ms) rows=${result.rowCount} — ${text.slice(0, 120)}`
      );
    }
    return result;
  } catch (err) {
    console.error('[pool] Query error:', err.message, '\nSQL:', text);
    throw err;
  }
}

/**
 * Acquire a dedicated client from the pool for explicit transaction management.
 *
 * @example
 * const { client, release } = await getClient();
 * try {
 *   await client.query('BEGIN');
 *   await client.query('INSERT ...');
 *   await client.query('COMMIT');
 * } catch (err) {
 *   await client.query('ROLLBACK');
 *   throw err;
 * } finally {
 *   release();
 * }
 *
 * @returns {Promise<{ client: import('pg').PoolClient, release: () => void }>}
 */
async function getClient() {
  const client = await pool.connect();
  return { client, release: () => client.release() };
}

/**
 * Wrap an async function in a transaction.
 * Automatically calls BEGIN / COMMIT / ROLLBACK.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const { client, release } = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    release();
  }
}

/**
 * Verify that the pool can reach the database.
 *
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  const result = await query('SELECT 1 AS ok');
  return result.rows[0].ok === 1;
}

/**
 * Drain all pool connections gracefully.
 * Call this during process shutdown (SIGTERM / SIGINT).
 *
 * @returns {Promise<void>}
 */
async function closePool() {
  await pool.end();
  console.info('[pool] Connection pool closed.');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  pool,
  query,
  getClient,
  withTransaction,
  healthCheck,
  closePool,
};

'use strict';

/**
 * Redis client wrapper
 *
 * Wraps the official `redis` v4 package with:
 *   - A single shared client instance (connectRedis / getClient)
 *   - Typed helper methods (setEx, get, del) that mirror the spec contract
 *   - Graceful reconnection with exponential back-off via the built-in
 *     socket.reconnectStrategy option
 *
 * Usage:
 *   const redis = require('./redis');
 *   await redis.connectRedis();           // called once in server.js
 *   await redis.setEx('key', 60, 'val');  // store with TTL
 *   const val = await redis.get('key');   // retrieve
 *   await redis.del('key');               // delete
 *   const raw = redis.getClient();        // raw ioredis-compatible client
 */

const { createClient } = require('redis');

// ─── Shared client instance ───────────────────────────────────────────────────

let _client = null;

// ─── connectRedis ─────────────────────────────────────────────────────────────

/**
 * Create, configure and connect the Redis client.
 * Should be called once at server start (in server.js / app bootstrap).
 *
 * @returns {Promise<import('redis').RedisClientType>}
 */
async function connectRedis() {
  if (_client && _client.isOpen) {
    return _client;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  _client = createClient({
    url: redisUrl,
    socket: {
      // Exponential back-off capped at 30 s; gives up after 10 retries
      reconnectStrategy: (retries) => {
        if (retries >= 10) {
          console.error('[redis] מספר מקסימלי של ניסיונות חיבור מחדש הגיע. מוותר.');
          return new Error('Redis connection retries exhausted');
        }
        const delay = Math.min(retries * 200, 30_000);
        console.warn(`[redis] ניסיון חיבור מחדש מספר ${retries + 1} בעוד ${delay}ms`);
        return delay;
      },
      connectTimeout: 10_000,
    },
  });

  _client.on('connect', () => {
    console.info('[redis] התחבר בהצלחה');
  });

  _client.on('error', (err) => {
    // Log but do not crash — the app can degrade gracefully in many cases
    console.error('[redis] שגיאת חיבור:', err.message);
  });

  _client.on('reconnecting', () => {
    console.warn('[redis] מנסה להתחבר מחדש...');
  });

  await _client.connect();
  return _client;
}

// ─── getClient ───────────────────────────────────────────────────────────────

/**
 * Return the shared Redis client.
 * Throws if connectRedis() has not been called yet.
 *
 * @returns {import('redis').RedisClientType}
 */
function getClient() {
  if (!_client) {
    throw new Error('[redis] Redis client לא אותחל. קרא ל-connectRedis() תחילה.');
  }
  return _client;
}

// ─── setEx ────────────────────────────────────────────────────────────────────

/**
 * Store a string value with an expiry in seconds.
 * Equivalent to Redis SET key value EX seconds.
 *
 * @param {string}        key
 * @param {number}        seconds  TTL in seconds (must be > 0)
 * @param {string}        value
 * @returns {Promise<void>}
 */
async function setEx(key, seconds, value) {
  if (!key || typeof seconds !== 'number' || seconds <= 0) {
    throw new Error('setEx: key ו-seconds תקניים נדרשים');
  }
  const client = getClient();
  // redis v4 SET with EX option returns 'OK' on success
  await client.set(key, String(value), { EX: seconds });
}

// ─── get ──────────────────────────────────────────────────────────────────────

/**
 * Retrieve a value by key.
 * Returns null when the key does not exist or has expired.
 *
 * @param {string} key
 * @returns {Promise<string|null>}
 */
async function get(key) {
  if (!key) {
    throw new Error('get: key נדרש');
  }
  const client = getClient();
  return client.get(key);
}

// ─── del ──────────────────────────────────────────────────────────────────────

/**
 * Delete one or more keys.
 * Silently succeeds when the key does not exist.
 *
 * @param {...string} keys  One or more Redis keys to delete
 * @returns {Promise<number>}  Number of keys actually deleted
 */
async function del(...keys) {
  if (!keys.length) return 0;
  const client = getClient();
  return client.del(keys);
}

// ─── exists ───────────────────────────────────────────────────────────────────

/**
 * Check whether a key exists.
 *
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function exists(key) {
  if (!key) return false;
  const client = getClient();
  const count = await client.exists(key);
  return count > 0;
}

// ─── closeRedis ───────────────────────────────────────────────────────────────

/**
 * Gracefully close the Redis connection.
 * Call this during process shutdown (SIGTERM / SIGINT).
 *
 * @returns {Promise<void>}
 */
async function closeRedis() {
  if (_client && _client.isOpen) {
    await _client.quit();
    console.info('[redis] חיבור נסגר בצורה מסודרת.');
  }
  _client = null;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  connectRedis,
  getClient,
  setEx,
  get,
  del,
  exists,
  closeRedis,
  // Expose the raw client accessor as `client` property for callers that want
  // direct access (e.g. pipeline / multi / pub-sub).
  get client() {
    return getClient();
  },
};

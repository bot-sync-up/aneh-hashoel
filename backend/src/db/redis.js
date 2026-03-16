'use strict';

/**
 * db/redis.js — Redis client (canonical path for db-layer imports)
 * ─────────────────────────────────────────────────────────────────────────────
 * The Redis client is implemented in services/redis.js with connection
 * management, exponential back-off reconnection, and typed helpers.
 *
 * This file is a thin re-export so that modules under db/ can import Redis
 * from a consistent location alongside db/pool.js:
 *
 *   const { getClient, setEx, get, del } = require('../db/redis');
 *
 * Lifecycle:
 *   Call connectRedis() once at server start (done in server.js).
 *   Call closeRedis() during graceful shutdown (SIGTERM / SIGINT).
 *
 * Exports mirror services/redis.js exactly:
 *   connectRedis  – Connect and configure the shared client
 *   getClient     – Return the live client instance
 *   setEx         – SET key value EX seconds
 *   get           – GET key  (returns string | null)
 *   del           – DEL ...keys
 *   exists        – EXISTS key  (returns boolean)
 *   closeRedis    – Graceful disconnect
 *   client        – Getter for the raw redis client (pipelines, pub/sub, etc.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

module.exports = require('../services/redis');

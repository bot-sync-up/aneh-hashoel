/**
 * Rate Limiters  –  src/middleware/rateLimiter.js
 *
 * All limiters use express-rate-limit v7 with the default in-memory store
 * (suitable for a single-process deployment; swap for RedisStore in multi-
 * process / cluster deployments).
 *
 * Exported limiters:
 *   apiLimiter      – 100 req / 15 min per IP           (general API routes)
 *   authLimiter     – 5 req / 15 min per IP             (login, forgot-password)
 *   loginLimiter    – alias for authLimiter
 *   claimLimiter    – 10 req / 1 min per rabbi ID       (question claiming)
 *   thankLimiter    – 3 req / 1 hour per IP per-question (thank button, Redis-checked)
 *   webhookLimiter  – 200 req / 1 min                   (WP / email webhooks)
 */

const rateLimit = require('express-rate-limit');
const { createClient } = require('redis');
const { logger } = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the real client IP.
 * Trusts the first value of X-Forwarded-For when set by a reverse proxy
 * (nginx, AWS ALB, Cloudflare) and falls back to the socket IP.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    return String(xff).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Lazy Redis client singleton used by thankLimiter for per-question tracking.
 * Only connected when the thank endpoint is first hit.
 * Falls back gracefully if Redis is unavailable (allows the request through).
 *
 * @returns {Promise<import('redis').RedisClientType | null>}
 */
let _redis = null;
async function getRedis() {
  if (_redis) return _redis;
  try {
    const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    client.on('error', (err) => {
      logger.warn('thankLimiter Redis error', { message: err.message });
    });
    await client.connect();
    _redis = client;
    return _redis;
  } catch (err) {
    logger.warn('thankLimiter could not connect to Redis — falling back to allow', {
      message: err.message,
    });
    return null;
  }
}

// ─── apiLimiter ───────────────────────────────────────────────────────────────

/**
 * General API rate limiter.
 * 100 requests per 15 minutes, keyed by IP address.
 * Applied to all /api/* routes that do not have a stricter limiter.
 */
const apiLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    clientIp,
  message: {
    ok:    false,
    error: 'חרגת ממגבלת הבקשות. נסה שוב בעוד 15 דקות.',
  },
});

// ─── authLimiter ──────────────────────────────────────────────────────────────

/**
 * Strict limiter for authentication endpoints.
 * 5 requests per 15 minutes per IP.
 * Covers: POST /auth/login, POST /auth/forgot-password, POST /auth/resend-otp.
 */
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    clientIp,
  message: {
    ok:    false,
    error: 'יותר מדי ניסיונות כניסה. נסה שוב בעוד 15 דקות.',
  },
});

// loginLimiter is an alias for authLimiter (used by auth.js)
const loginLimiter = authLimiter;

// ─── claimLimiter ─────────────────────────────────────────────────────────────

/**
 * Limiter for the question-claiming endpoint.
 * 10 requests per minute, keyed by the authenticated rabbi's ID.
 * Falls back to IP when the rabbi is not yet authenticated.
 *
 * Apply AFTER the authenticate middleware so req.rabbi is populated.
 */
const claimLimiter = rateLimit({
  windowMs:        60 * 1000, // 1 minute
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => {
    if (req.rabbi?.id) {
      return `rabbi:${req.rabbi.id}`;
    }
    return clientIp(req);
  },
  message: {
    ok:    false,
    error: 'חרגת ממגבלת תביעות השאלות. נסה שוב בעוד דקה.',
  },
});

// ─── thankLimiter ─────────────────────────────────────────────────────────────

/**
 * Rate limiter for the "thank rabbi" button.
 * Allows a maximum of 3 presses per IP per question per hour.
 * Per-question tracking is stored in Redis to survive across requests.
 *
 * The outer express-rate-limit guard limits total thank requests to 3/hour/IP
 * (prevents Redis spam).  The Redis check then further enforces the per-question
 * constraint.
 *
 * Usage in route handler:
 *   router.post('/:id/thank', thankLimiter, thankRateLimitPerQuestion, handler);
 *
 * `thankRateLimitPerQuestion` is a separate async middleware (exported below)
 * because express-rate-limit does not natively support composite keys that
 * include a request body/param value.
 */
const thankLimiter = rateLimit({
  windowMs:        60 * 60 * 1000, // 1 hour
  max:             3,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    clientIp,
  message: {
    ok:    false,
    error: 'כבר הודית לרב על שאלה זו. ניתן להודות שוב בעוד שעה.',
  },
});

/**
 * Additional per-question Redis guard for the thank endpoint.
 * Must be used alongside `thankLimiter`.
 *
 * Redis key:  thank:<ip>:<questionId>
 * TTL:        1 hour
 * Max count:  3
 *
 * If Redis is unavailable, the request is allowed through (fail-open).
 *
 * @type {import('express').RequestHandler}
 */
async function thankRateLimitPerQuestion(req, res, next) {
  const ip         = clientIp(req);
  const questionId = req.params.id || req.params.questionId;

  if (!questionId) {
    // No question context — fall through to the route which will validate
    return next();
  }

  const redis = await getRedis();
  if (!redis) {
    // Redis unavailable — allow request (fail-open), outer limiter still applies
    return next();
  }

  const key = `thank:${ip}:${questionId}`;
  const WINDOW_SECONDS = 60 * 60; // 1 hour
  const MAX_THANKS     = 3;

  try {
    const current = await redis.incr(key);

    if (current === 1) {
      // First thank for this IP+question in this window — set TTL
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (current > MAX_THANKS) {
      return res.status(429).json({
        ok:    false,
        error: 'כבר הודית לרב על שאלה זו. ניתן להודות שוב בעוד שעה.',
      });
    }

    return next();
  } catch (err) {
    logger.warn('thankRateLimitPerQuestion Redis error — allowing request', {
      message: err.message,
    });
    return next();
  }
}

// ─── webhookLimiter ───────────────────────────────────────────────────────────

/**
 * Generous limiter for inbound webhook endpoints (WordPress, SendGrid inbound parse).
 * 200 requests per minute per IP.
 * Protects the server from runaway webhook delivery loops or spoofed traffic.
 */
const webhookLimiter = rateLimit({
  windowMs:        60 * 1000, // 1 minute
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    clientIp,
  message: {
    ok:    false,
    error: 'יותר מדי בקשות לנקודת הקצה של ה-webhook.',
  },
});

// Aliases for backward compatibility
const forgotPasswordLimiter = authLimiter;
const emailLimiter = authLimiter;

module.exports = {
  apiLimiter,
  authLimiter,
  loginLimiter,
  forgotPasswordLimiter,
  emailLimiter,
  claimLimiter,
  thankLimiter,
  thankRateLimitPerQuestion,
  webhookLimiter,
};

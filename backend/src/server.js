'use strict';

/**
 * server.js — Express + Socket.io entry point for "ענה את השואל"
 *
 * Startup sequence:
 *   1. Load environment variables (.env)
 *   2. Build Express app + HTTP server
 *   3. Attach Socket.io
 *   4. Register middleware (helmet, cors, morgan, json)
 *   5. Mount webhook routes BEFORE auth-protected API routes
 *   6. Mount API routes
 *   7. Connect to DB + Redis
 *   8. Initialize Socket.io handlers
 *   9. Start cron jobs
 *  10. Listen on PORT
 *  11. Register graceful shutdown handlers
 */

require('dotenv').config();

const express        = require('express');
const cors           = require('cors');
const helmet         = require('helmet');
const morgan         = require('morgan');
const { createServer }  = require('http');
const { Server }        = require('socket.io');

const { logger, morganStream } = require('./utils/logger');
const log = logger.child({ module: 'server' });

// ─── Infrastructure ───────────────────────────────────────────────────────────

const { closePool }        = require('./db/pool');
const { connectRedis, closeRedis } = require('./services/redis');
const { initSocketHandlers }       = require('./socket/handlers');
const { startCronJobs }            = require('./cron');

// ─── API routes ───────────────────────────────────────────────────────────────

const authRoutes              = require('./routes/auth');
const questionRoutes          = require('./routes/questions');
const rabbiRoutes             = require('./routes/rabbis');
const categoryRoutes          = require('./routes/categories');
const discussionRoutes        = require('./routes/discussions');
const questionDiscussionRoutes = require('./routes/questionDiscussion');
const notificationRoutes      = require('./routes/notifications');
const profileRoutes           = require('./routes/profile');
const adminRoutes             = require('./routes/admin');
const actionLinksRoute        = require('./routes/actionLinks');
const leadsRoutes             = require('./routes/leads');

// ─── Webhook routes (no JWT auth — validated by their own secrets) ────────────

const wpWebhook       = require('./routes/wpWebhook');
const emailWebhook    = require('./routes/emailWebhook');
const emailInbound    = require('./routes/emailInbound');
const whatsappWebhook = require('./routes/whatsappWebhook');
const donationsWebhook = require('./routes/donationsWebhook');

// ─── App + HTTP server ────────────────────────────────────────────────────────

const app        = express();
const httpServer = createServer(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const io = new Server(httpServer, {
  cors: {
    origin:      FRONTEND_URL,
    methods:     ['GET', 'POST'],
    credentials: true,
  },
  // Reconnection ping keeps idle connections alive through proxies
  pingTimeout:  60_000,
  pingInterval: 25_000,
});

// Make io accessible inside route handlers via req.app.get('io')
app.set('io', io);

// ─── Core middleware ──────────────────────────────────────────────────────────

// Trust first proxy (nginx) so X-Forwarded-For is respected for rate limiting
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// CORS — allow the React frontend + WordPress site to call the API
app.use(
  cors({
    origin: [
      FRONTEND_URL,
      'https://moreshet-maran.com',
      'https://www.moreshet-maran.com',
    ].filter(Boolean),
    credentials: true,
  })
);

// HTTP request logging — pipe Morgan output through pino
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', { stream: morganStream }));

// JSON body parsing (10 MB limit to accept rich question content)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Import centralized rate limiters from middleware/rateLimiter.js.
// apiLimiter:   100 req/min per IP — blanket limiter for all /api/* routes
// writeLimiter: 30 req/min per IP  — additional cap on POST/PUT/PATCH/DELETE
// authLimiter:  stricter limiter for auth endpoints (stacks on top of the above)

const { apiLimiter, writeLimiter, authLimiter } = require('./middleware/rateLimiter');

// ─── Webhook routes (BEFORE auth middleware) ──────────────────────────────────
// These endpoints are called by external services (WordPress, SendGrid, GreenAPI).
// They authenticate via their own secret headers, not JWT.

app.use('/webhook/wordpress', wpWebhook);
app.use('/webhook/email',     emailWebhook);
app.use('/api/email',         emailInbound);    // Mailgun inbound webhook
app.use('/webhook/whatsapp',  whatsappWebhook);
app.use('/webhook/nedarim',  donationsWebhook);

// ─── API rate limiting (applied to ALL /api/* routes) ────────────────────────
// General limiter: 100 requests per minute per IP (all methods)
// Write limiter:   30 requests per minute per IP (POST/PUT/PATCH/DELETE only)
// These stack with route-specific limiters (auth, claim, thank) which are stricter.

app.use('/api', apiLimiter);
app.use('/api', writeLimiter);

// ─── API routes ───────────────────────────────────────────────────────────────

app.use('/api/auth',          authLimiter, authRoutes);
app.use('/api/questions',     questionRoutes);
app.use('/api/questions',     questionDiscussionRoutes); // nested: /api/questions/:id/discussion
app.use('/api/rabbis',        rabbiRoutes);
app.use('/api/categories',    categoryRoutes);
app.use('/api/discussions',   discussionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/profile',       profileRoutes);
app.use('/api/dashboard',  require('./routes/dashboard'));
app.use('/api/admin/system',    require('./routes/admin/system'));
app.use('/api/admin/rabbis',    require('./routes/admin/rabbis'));
app.use('/api/admin/questions', require('./routes/admin/questions'));
app.use('/api/admin',           adminRoutes);
app.use('/api/admin/dashboard', require('./routes/admin/dashboard'));
app.use('/api/admin/sync',   require('./routes/admin/sync'));
app.use('/api/admin/donations', require('./routes/admin/donations'));
app.use('/api/admin/support', require('./routes/support'));
app.use('/api/support',      require('./routes/support'));
app.use('/api/action',        actionLinksRoute);
app.use('/api/leads',         leadsRoutes);
app.use('/api/track',         require('./routes/track'));
app.use('/unsubscribe',       require('./routes/unsubscribe'));
app.use('/api/unsubscribe',   require('./routes/unsubscribe'));

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    time:     new Date().toISOString(),
    uptime:   Math.floor(process.uptime()),
  });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `נתיב לא נמצא: ${req.method} ${req.path}` });
});

// ─── Global error handler ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  log.error({ err }, 'Unhandled error');
  res.status(err.status || 500).json({
    error: err.message || 'שגיאת שרת פנימית',
  });
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

/**
 * Close all resources in the correct order so in-flight requests can complete
 * and connections are released cleanly.
 *
 * @param {NodeJS.Signals} signal
 */
async function shutdown(signal) {
  log.info({ signal }, 'Shutting down gracefully...');

  // Stop accepting new HTTP connections
  httpServer.close(async () => {
    log.info('HTTP server closed');

    // Close Socket.io (disconnect all clients cleanly)
    io.close(() => {
      log.info('Socket.io server closed');
    });

    try {
      await closeRedis();
      log.info('Redis closed');
    } catch (err) {
      log.error({ err }, 'Error closing Redis');
    }

    try {
      await closePool();
      log.info('DB pool closed');
    } catch (err) {
      log.error({ err }, 'Error closing DB pool');
    }

    log.info('Shutdown complete');
    process.exit(0);
  });

  // Force exit after 15 s if graceful shutdown stalls
  setTimeout(() => {
    log.fatal('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── Startup ──────────────────────────────────────────────────────────────────

/**
 * Bootstrap the server:
 *   1. Connect to PostgreSQL
 *   2. Connect to Redis
 *   3. Wire Socket.io handlers
 *   4. Start cron jobs
 *   5. Bind to PORT
 */
async function start() {
  // We require pool lazily so the module is already loaded before we connect.
  const { pool } = require('./db/pool');

  // Verify DB connectivity on startup
  try {
    await pool.query('SELECT 1');
    log.info('PostgreSQL connected');
  } catch (err) {
    log.fatal({ err }, 'PostgreSQL connection failed');
    process.exit(1);
  }

  // Connect Redis (non-fatal: degrade gracefully if unavailable)
  try {
    await connectRedis();
    log.info('Redis connected');
  } catch (err) {
    log.warn({ err }, 'Redis unavailable — continuing without Redis');
  }

  // Wire Socket.io authentication + event handlers
  initSocketHandlers(io);

  // Give questionService access to io so _emitSafe works (thankReceived, followUp, etc.)
  require('./services/questionService').setIO(io);

  // Ensure email templates are seeded in DB so admin UI always has full
  // editable content (non-blocking — logs on failure).
  try {
    const { seedDefaultEmailTemplates } = require('./services/emailTemplates');
    await seedDefaultEmailTemplates();
  } catch (err) {
    log.warn({ err }, 'email-templates seed failed — continuing');
  }

  // Start background cron jobs (pass io so polling sync can broadcast socket events)
  startCronJobs(io);

  const PORT = parseInt(process.env.PORT || '3001', 10);

  httpServer.listen(PORT, () => {
    log.info({ port: PORT, env: process.env.NODE_ENV || 'development', frontendUrl: FRONTEND_URL }, `Listening on port ${PORT}`);
  });
}

// Skip startup when imported for testing (NODE_ENV=test)
if (process.env.NODE_ENV !== 'test') {
  start().catch((err) => {
    log.fatal({ err }, 'Fatal startup error');
    process.exit(1);
  });
}

// ─── Exports (for testing) ────────────────────────────────────────────────────

module.exports = { app, httpServer, io };

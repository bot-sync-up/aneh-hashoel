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
const rateLimit      = require('express-rate-limit');
const { createServer }  = require('http');
const { Server }        = require('socket.io');

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
const whatsappWebhook = require('./routes/whatsappWebhook');

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

// CORS — allow the React frontend to call the API with credentials
app.use(
  cors({
    origin:      FRONTEND_URL,
    credentials: true,
  })
);

// HTTP request logging
// Use 'dev' format in development for colourised, concise output;
// use 'combined' (Apache format) in production for structured log ingestion.
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// JSON body parsing (10 MB limit to accept rich question content)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1_000, // 15 minutes
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'יותר מדי ניסיונות כניסה. נסה שוב בעוד 15 דקות.' },
});

// ─── Webhook routes (BEFORE auth middleware) ──────────────────────────────────
// These endpoints are called by external services (WordPress, SendGrid, GreenAPI).
// They authenticate via their own secret headers, not JWT.

app.use('/webhook/wordpress', wpWebhook);
app.use('/webhook/email',     emailWebhook);
app.use('/webhook/whatsapp',  whatsappWebhook);

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
app.use('/api/admin',         adminRoutes);
app.use('/api/admin/dashboard', require('./routes/admin/dashboard'));
app.use('/api/admin/sync',   require('./routes/admin/sync'));
app.use('/api/admin/support', require('./routes/support'));
app.use('/api/support',      require('./routes/support'));
app.use('/api/action',        actionLinksRoute);
app.use('/api/leads',         leadsRoutes);
app.use('/api/track',         require('./routes/track'));

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
  console.error('[server] Unhandled error:', err.stack || err.message);
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
  console.log(`\n[server] ${signal} received — shutting down gracefully...`);

  // Stop accepting new HTTP connections
  httpServer.close(async () => {
    console.log('[server] HTTP server closed');

    // Close Socket.io (disconnect all clients cleanly)
    io.close(() => {
      console.log('[server] Socket.io server closed');
    });

    try {
      await closeRedis();
      console.log('[server] Redis closed');
    } catch (err) {
      console.error('[server] Error closing Redis:', err.message);
    }

    try {
      await closePool();
      console.log('[server] DB pool closed');
    } catch (err) {
      console.error('[server] Error closing DB pool:', err.message);
    }

    console.log('[server] Shutdown complete');
    process.exit(0);
  });

  // Force exit after 15 s if graceful shutdown stalls
  setTimeout(() => {
    console.error('[server] Graceful shutdown timed out — forcing exit');
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
    console.log('[server] PostgreSQL connected');
  } catch (err) {
    console.error('[server] PostgreSQL connection failed:', err.message);
    process.exit(1);
  }

  // Connect Redis (non-fatal: degrade gracefully if unavailable)
  try {
    await connectRedis();
    console.log('[server] Redis connected');
  } catch (err) {
    console.warn('[server] Redis unavailable — continuing without Redis:', err.message);
  }

  // Wire Socket.io authentication + event handlers
  initSocketHandlers(io);

  // Start background cron jobs (pass io so polling sync can broadcast socket events)
  startCronJobs(io);

  const PORT = parseInt(process.env.PORT || '3001', 10);

  httpServer.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    console.log(`[server] Frontend: ${FRONTEND_URL}`);
  });
}

start().catch((err) => {
  console.error('[server] Fatal startup error:', err.stack || err.message);
  process.exit(1);
});

// ─── Exports (for testing) ────────────────────────────────────────────────────

module.exports = { app, httpServer, io };

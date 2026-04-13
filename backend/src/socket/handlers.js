'use strict';

/**
 * Main Socket.io Initialization — handlers.js
 *
 * Sets up JWT authentication middleware, connection/disconnect handlers,
 * room management, and attaches sub-handler modules for questions,
 * discussions, and notifications.
 *
 * Exports:
 *   initSocketHandlers(io)  — call once from server.js during startup
 *   getIO()                 — return the active Server instance (or null)
 *   getConnectedRabbis()    — return the live Map<rabbiId, Set<socketId>>
 */

const jwt = require('jsonwebtoken');
const { connectedRabbis, emitToAdmins } = require('./helpers');
const { registerQuestionEvents }         = require('./questionEvents');
const { attachDiscussionHandlers }       = require('./discussionEvents');

/** @type {import('socket.io').Server|null} */
let _io = null;

// ─── Authentication middleware ────────────────────────────────────────────────

/**
 * Socket.io middleware that verifies the JWT access token supplied in
 * socket.handshake.auth.token.
 *
 * On success, attaches the following fields to socket.data:
 *   rabbiId   {string}  — rabbi's primary key (payload.sub)
 *   role      {string}  — 'rabbi' | 'admin'
 *   rabbiName {string}  — display name from token (payload.name), may be ''
 *
 * On failure, rejects the connection with a descriptive Hebrew error.
 *
 * @param {import('socket.io').Socket} socket
 * @param {function(Error=): void}     next
 */
function authMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error('נדרשת התחברות'));
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[socket:auth] JWT_SECRET לא מוגדר');
    return next(new Error('שגיאת תצורת שרת'));
  }

  try {
    const payload = jwt.verify(token, secret, { issuer: 'aneh-hashoel' });

    socket.data.rabbiId   = String(payload.sub);
    socket.data.role      = payload.role  || 'rabbi';
    socket.data.rabbiName = payload.name  || '';

    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new Error('פג תוקף ההתחברות. נא להתחבר מחדש'));
    }
    return next(new Error('טוקן אימות אינו תקין'));
  }
}

// ─── Connection handler ───────────────────────────────────────────────────────

/**
 * Handle a new authenticated socket connection.
 *
 * Rooms joined:
 *   rabbi:{rabbiId}  — personal room for direct notifications
 *   all-rabbis       — broadcast channel for question queue events
 *   admins           — admin-only events (joined when role === 'admin')
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function onConnection(io, socket) {
  const { rabbiId, role, rabbiName } = socket.data;

  // ── Update connectedRabbis Map<rabbiId, Set<socketId>> ────────────────────
  if (!connectedRabbis.has(rabbiId)) {
    connectedRabbis.set(rabbiId, new Set());
  }
  connectedRabbis.get(rabbiId).add(socket.id);

  // ── Join rooms ────────────────────────────────────────────────────────────
  socket.join(`rabbi:${rabbiId}`);
  socket.join('all-rabbis');

  if (role === 'admin') {
    socket.join('admins');
    socket.join('cs-agents'); // admins also see CS events
  }

  if (role === 'customer_service') {
    socket.join('cs-agents');
  }

  // ── Notify admins of new connection ──────────────────────────────────────
  emitToAdmins(io, 'rabbi:connected', {
    rabbiId,
    rabbiName,
    role,
    socketId:  socket.id,
    timestamp: new Date().toISOString(),
  });

  console.log(
    `[socket] Rabbi ${rabbiId} connected` +
    ` (socket ${socket.id}, role: ${role}).` +
    ` Online rabbis: ${connectedRabbis.size}`
  );

  // ── Attach sub-handlers ───────────────────────────────────────────────────
  registerQuestionEvents(io, socket);
  attachDiscussionHandlers(socket, io);

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    const sockets = connectedRabbis.get(rabbiId);
    if (sockets) {
      sockets.delete(socket.id);
      // Remove the entry entirely when the rabbi has no remaining connections
      if (sockets.size === 0) {
        connectedRabbis.delete(rabbiId);
      }
    }

    // Only notify admins when the rabbi has fully gone offline
    const stillOnline = connectedRabbis.has(rabbiId);
    if (!stillOnline) {
      emitToAdmins(io, 'rabbi:disconnected', {
        rabbiId,
        rabbiName,
        reason,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(
      `[socket] Rabbi ${rabbiId} disconnected (${reason}).` +
      ` Remaining sockets for this rabbi: ${connectedRabbis.get(rabbiId)?.size ?? 0}.` +
      ` Online rabbis: ${connectedRabbis.size}`
    );
  });

  // ── Error logging ─────────────────────────────────────────────────────────
  socket.on('error', (err) => {
    console.error(
      `[socket] Error on socket ${socket.id} (rabbi ${rabbiId}):`,
      err.message
    );
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize Socket.io handlers on the server instance.
 * Called once from server.js immediately after creating the Server.
 *
 * @param {import('socket.io').Server} io - Socket.io server instance
 */
function initSocketHandlers(io) {
  _io = io;

  // Apply JWT auth middleware to every incoming connection
  io.use(authMiddleware);

  // Handle new authenticated connections
  io.on('connection', (socket) => onConnection(io, socket));

  console.log('[socket] Socket.io handlers initialized');
}

/**
 * Return the active Socket.io server instance.
 * Returns null if initSocketHandlers has not yet been called.
 *
 * @returns {import('socket.io').Server|null}
 */
function getIO() {
  return _io;
}

/**
 * Return the live connected-rabbis registry.
 *
 * @returns {Map<string, Set<string>>}  rabbiId → Set of socket IDs
 */
function getConnectedRabbis() {
  return connectedRabbis;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  initSocketHandlers,
  getIO,
  getConnectedRabbis,
};

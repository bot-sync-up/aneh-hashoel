'use strict';

/**
 * Socket.io Utility Helpers
 *
 * Convenience functions for emitting events to specific rooms and
 * querying connected rabbi state. Used by route handlers, services,
 * and other socket event modules.
 *
 * connectedRabbis: Map<rabbiId, Set<socketId>>
 *   A rabbi with multiple browser tabs open will have multiple socket IDs.
 *   Mutations happen exclusively in handlers.js (on connect / disconnect).
 */

// ─── Connected rabbis registry ────────────────────────────────────────────────

/**
 * Tracks online rabbis.
 *
 * Map<string, Set<string>>  →  rabbiId → Set of active socket IDs
 *
 * A rabbi appearing in this Map is considered "online".
 * The Set is empty only transiently and is pruned on disconnect.
 */
const connectedRabbis = new Map();

// ─── Emit helpers ─────────────────────────────────────────────────────────────

/**
 * Emit an event to a specific rabbi via their personal room.
 *
 * @param {import('socket.io').Server} io      - Socket.io server instance
 * @param {string}                     rabbiId - Target rabbi ID
 * @param {string}                     event   - Event name
 * @param {*}                          data    - Payload
 */
function emitToRabbi(io, rabbiId, event, data) {
  try {
    io.to(`rabbi:${rabbiId}`).emit(event, data);
  } catch (err) {
    console.error(`[socket:helpers] emitToRabbi failed for rabbi ${rabbiId}:`, err.message);
  }
}

/**
 * Emit an event to all connected rabbis.
 *
 * @param {import('socket.io').Server} io    - Socket.io server instance
 * @param {string}                     event - Event name
 * @param {*}                          data  - Payload
 */
function emitToAll(io, event, data) {
  try {
    io.to('all-rabbis').emit(event, data);
  } catch (err) {
    console.error('[socket:helpers] emitToAll failed:', err.message);
  }
}

/**
 * Emit an event to the admin room only.
 *
 * @param {import('socket.io').Server} io    - Socket.io server instance
 * @param {string}                     event - Event name
 * @param {*}                          data  - Payload
 */
function emitToAdmins(io, event, data) {
  try {
    io.to('admins').emit(event, data);
  } catch (err) {
    console.error('[socket:helpers] emitToAdmins failed:', err.message);
  }
}

/**
 * Emit an event to the customer-service agents room.
 *
 * @param {import('socket.io').Server} io    - Socket.io server instance
 * @param {string}                     event - Event name
 * @param {*}                          data  - Payload
 */
function emitToCSAgents(io, event, data) {
  try {
    io.to('cs-agents').emit(event, data);
  } catch (err) {
    console.error('[socket:helpers] emitToCSAgents failed:', err.message);
  }
}

/**
 * Emit an event to all members of a specific discussion room.
 *
 * @param {import('socket.io').Server} io           - Socket.io server instance
 * @param {string}                     discussionId - Discussion ID
 * @param {string}                     event        - Event name
 * @param {*}                          data         - Payload
 */
function emitToDiscussion(io, discussionId, event, data) {
  try {
    io.to(`discussion:${discussionId}`).emit(event, data);
  } catch (err) {
    console.error(
      `[socket:helpers] emitToDiscussion failed for discussion ${discussionId}:`,
      err.message
    );
  }
}

// ─── Presence helpers ─────────────────────────────────────────────────────────

/**
 * Return an array of rabbi IDs currently present in the `all-rabbis` room.
 * Derived from socket.data on each socket in the room so it reflects the
 * live Socket.io adapter state rather than the local Map alone.
 *
 * Falls back to reading from connectedRabbis when the adapter lookup is
 * unavailable (e.g. during unit tests).
 *
 * @param {import('socket.io').Server} io - Socket.io server instance
 * @returns {string[]} Array of online rabbi IDs (deduplicated)
 */
function getOnlineRabbiIds(io) {
  try {
    // Ask the in-memory adapter for every socket in the all-rabbis room
    const room = io.sockets.adapter.rooms.get('all-rabbis');
    if (!room) return [];

    const seen = new Set();
    for (const socketId of room) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket && socket.data && socket.data.rabbiId) {
        seen.add(String(socket.data.rabbiId));
      }
    }
    return Array.from(seen);
  } catch (_) {
    // Fallback: derive from local Map
    return Array.from(connectedRabbis.keys());
  }
}

/**
 * Check whether a specific rabbi currently has at least one active connection.
 *
 * @param {import('socket.io').Server} io      - Socket.io server instance
 * @param {string}                     rabbiId - Rabbi ID to check
 * @returns {boolean}
 */
function isRabbiOnline(io, rabbiId) {
  // Primary source: local Map (fastest)
  if (connectedRabbis.has(String(rabbiId))) {
    const sockets = connectedRabbis.get(String(rabbiId));
    if (sockets && sockets.size > 0) return true;
  }

  // Secondary: check the adapter room directly
  try {
    const room = io.sockets.adapter.rooms.get(`rabbi:${rabbiId}`);
    return room != null && room.size > 0;
  } catch (_) {
    return false;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  connectedRabbis,
  emitToRabbi,
  emitToAll,
  emitToAdmins,
  emitToCSAgents,
  emitToDiscussion,
  getOnlineRabbiIds,
  isRabbiOnline,
};

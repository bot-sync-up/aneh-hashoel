'use strict';

/**
 * Notification Socket.io Events — notificationEvents.js
 *
 * Server-to-client push functions.  These are NOT socket listeners;
 * they are called from services, routes, and cron jobs to push
 * notifications to individual rabbis or the entire online cohort.
 *
 * All functions are fire-and-forget — they log errors but never throw,
 * so a failed socket emit never crashes a request/service flow.
 *
 * Exports (spec-aligned names):
 *   sendToRabbi       — notification:new         → rabbi:{rabbiId}
 *   broadcastToAll    — notification:new         → all-rabbis
 *   sendEmergency     — notification:emergency   → all-rabbis
 *   updateBadge       — notification:badgeUpdate → rabbi:{rabbiId}
 *   sendNewDeviceAlert — notification:newDeviceAlert → rabbi:{rabbiId}
 */

const { emitToRabbi, emitToAll } = require('./helpers');

// ─── sendToRabbi ──────────────────────────────────────────────────────────────

/**
 * Send a notification to a specific rabbi via their personal room.
 *
 * Event:   notification:new
 * Payload: { title, body, type, link, timestamp, …notification }
 *
 * @param {import('socket.io').Server} io           - Socket.io server instance
 * @param {string}                     rabbiId      - Target rabbi ID
 * @param {object}                     notification - Notification payload
 * @param {string}                     notification.title  - Title text
 * @param {string}                     notification.body   - Body text
 * @param {string}                     [notification.type] - 'info'|'success'|'warning'|'error'
 * @param {string}                     [notification.link] - Optional deep-link
 */
function sendToRabbi(io, rabbiId, notification) {
  if (!rabbiId || !notification) {
    console.warn('[socket:notification] sendToRabbi called with missing params');
    return;
  }

  emitToRabbi(io, rabbiId, 'notification:new', {
    ...notification,
    timestamp: new Date().toISOString(),
  });
}

// ─── broadcastToAll ───────────────────────────────────────────────────────────

/**
 * Broadcast a notification to all connected rabbis.
 *
 * Event:   notification:new
 * Payload: { title, body, type, timestamp, …notification }
 *
 * @param {import('socket.io').Server} io           - Socket.io server instance
 * @param {object}                     notification - Notification payload
 * @param {string}                     notification.title  - Title text
 * @param {string}                     notification.body   - Body text
 * @param {string}                     [notification.type] - 'info'|'success'|'warning'|'error'
 */
function broadcastToAll(io, notification) {
  if (!notification) {
    console.warn('[socket:notification] broadcastToAll called with missing payload');
    return;
  }

  emitToAll(io, 'notification:new', {
    ...notification,
    timestamp: new Date().toISOString(),
  });
}

// ─── sendEmergency ────────────────────────────────────────────────────────────

/**
 * Broadcast an emergency alert to all connected rabbis.
 * The client should display this as a prominent, non-dismissable popup.
 *
 * Event:   notification:emergency
 * Payload: { message, urgent: true, priority: 'critical', timestamp }
 *
 * @param {import('socket.io').Server} io      - Socket.io server instance
 * @param {string}                     message - Emergency message text
 */
function sendEmergency(io, message) {
  if (!message) {
    console.warn('[socket:notification] sendEmergency called without message');
    return;
  }

  emitToAll(io, 'notification:emergency', {
    message,
    urgent:    true,
    priority:  'critical',
    timestamp: new Date().toISOString(),
  });

  console.log(`[socket:notification] Emergency broadcast sent: ${message}`);
}

// ─── updateBadge ──────────────────────────────────────────────────────────────

/**
 * Update the notification badge counters displayed in the UI for a specific rabbi.
 *
 * Event:   notification:badgeUpdate
 * Payload: { unread, timestamp, …counts }
 *
 * @param {import('socket.io').Server} io      - Socket.io server instance
 * @param {string}                     rabbiId - Target rabbi ID
 * @param {object}                     counts  - Badge counts
 * @param {number}                     counts.unread      - Total unread notifications
 * @param {number}                     [counts.questions]  - New questions count
 * @param {number}                     [counts.discussions] - Unread discussion messages
 */
function updateBadge(io, rabbiId, counts) {
  if (!rabbiId || !counts) {
    console.warn('[socket:notification] updateBadge called with missing params');
    return;
  }

  emitToRabbi(io, rabbiId, 'notification:badgeUpdate', {
    unread:    counts.unread ?? 0,
    ...counts,
    timestamp: new Date().toISOString(),
  });
}

// ─── sendNewDeviceAlert ───────────────────────────────────────────────────────

/**
 * Alert a rabbi that a new device has logged into their account.
 * The rabbi's UI should show a security notification prompting them to
 * verify or revoke the session if they do not recognise the device.
 *
 * Event:   notification:newDeviceAlert
 * Payload: { deviceInfo, message, timestamp }
 *
 * @param {import('socket.io').Server} io         - Socket.io server instance
 * @param {string}                     rabbiId    - Target rabbi ID
 * @param {object}                     deviceInfo - Device information
 * @param {string}                     deviceInfo.browser   - Browser name
 * @param {string}                     deviceInfo.os        - Operating system
 * @param {string}                     deviceInfo.ip        - IP address (masked)
 * @param {string}                     [deviceInfo.location] - Approximate location
 */
function sendNewDeviceAlert(io, rabbiId, deviceInfo) {
  if (!rabbiId || !deviceInfo) {
    console.warn('[socket:notification] sendNewDeviceAlert called with missing params');
    return;
  }

  emitToRabbi(io, rabbiId, 'notification:newDeviceAlert', {
    deviceInfo,
    message:   'זוהתה התחברות ממכשיר חדש',
    timestamp: new Date().toISOString(),
  });

  console.log(`[socket:notification] New device alert sent to rabbi ${rabbiId}`);
}

// ─── Legacy aliases (for callers that use old export names) ───────────────────

/** @deprecated Use sendToRabbi */
const sendNotification       = sendToRabbi;
/** @deprecated Use broadcastToAll */
const broadcastNotification  = broadcastToAll;
/** @deprecated Use sendEmergency */
const sendEmergencyBroadcast = sendEmergency;
/** @deprecated Use updateBadge */
const updateBadgeCount       = updateBadge;

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Spec-defined names
  sendToRabbi,
  broadcastToAll,
  sendEmergency,
  updateBadge,
  sendNewDeviceAlert,

  // Legacy aliases
  sendNotification,
  broadcastNotification,
  sendEmergencyBroadcast,
  updateBadgeCount,
};

'use strict';

/**
 * Discussion / Chat Socket.io Events — discussionEvents.js
 *
 * Two responsibilities:
 *
 *  1. Per-socket listeners (attachDiscussionHandlers) — attached in handlers.js
 *     on every new connection.  Handles join/leave, typing indicators, and
 *     client-initiated discussion:message events.
 *
 *  2. Server-push helpers (emitNew*, emit*) — called from route handlers and
 *     services after they persist data to the DB.  These push the resulting
 *     events to the correct discussion room without involving a specific socket.
 */

const { emitToDiscussion } = require('./helpers');
const { query: db }        = require('../db/pool');

// ─── Per-socket listeners ─────────────────────────────────────────────────────

/**
 * Attach discussion-related event listeners to a newly connected socket.
 * Called from handlers.js inside the 'connection' handler.
 *
 * @param {import('socket.io').Socket} socket - The connected socket
 * @param {import('socket.io').Server} io     - Socket.io server instance
 */
function attachDiscussionHandlers(socket, io) {
  const rabbiId   = socket.data.rabbiId;
  const rabbiName = socket.data.rabbiName || '';

  // ── discussion:join ────────────────────────────────────────────────────────

  /**
   * Rabbi joins a discussion room so they receive live messages.
   * Also updates last_read_at in the DB so unread counts are accurate.
   *
   * Client sends:  socket.emit('discussion:join', { discussionId })
   */
  socket.on('discussion:join', async ({ discussionId } = {}) => {
    if (!discussionId) return;

    const room = `discussion:${discussionId}`;
    socket.join(room);

    // Notify other room members that someone joined
    socket.to(room).emit('discussion:memberJoined', {
      discussionId,
      rabbiId,
      rabbiName,
      timestamp: new Date().toISOString(),
    });

    // Persist last_read_at so the participant's unread counter resets.
    // Silently swallow DB errors — the join itself is not blocked by this.
    try {
      await db(
        `UPDATE discussion_participants
         SET    last_read_at = NOW()
         WHERE  discussion_id = $1
           AND  rabbi_id      = $2`,
        [discussionId, rabbiId]
      );
    } catch (err) {
      console.warn(
        `[socket:discussion] Could not update last_read_at` +
        ` (discussion=${discussionId} rabbi=${rabbiId}):`,
        err.message
      );
    }

    console.log(`[socket:discussion] Rabbi ${rabbiId} joined discussion ${discussionId}`);
  });

  // ── discussion:leave ───────────────────────────────────────────────────────

  /**
   * Rabbi leaves a discussion room.
   *
   * Client sends:  socket.emit('discussion:leave', { discussionId })
   */
  socket.on('discussion:leave', ({ discussionId } = {}) => {
    if (!discussionId) return;

    const room = `discussion:${discussionId}`;

    // Notify before leaving so the departing rabbi is still in the room
    socket.to(room).emit('discussion:memberLeft', {
      discussionId,
      rabbiId,
      rabbiName,
      timestamp: new Date().toISOString(),
    });

    socket.leave(room);
    console.log(`[socket:discussion] Rabbi ${rabbiId} left discussion ${discussionId}`);
  });

  // ── discussion:typing ──────────────────────────────────────────────────────

  /**
   * Typing indicator — rabbi started typing in a discussion.
   *
   * Client sends:  socket.emit('discussion:typing', { discussionId })
   * Room receives: { discussionId, rabbiId, rabbiName } (sender excluded)
   */
  socket.on('discussion:typing', ({ discussionId } = {}) => {
    if (!discussionId) return;

    socket.to(`discussion:${discussionId}`).emit('discussion:typing', {
      discussionId,
      rabbiId,
      rabbiName,
    });
  });

  // ── discussion:stopTyping ──────────────────────────────────────────────────

  /**
   * Typing indicator — rabbi stopped typing.
   *
   * Client sends:  socket.emit('discussion:stopTyping', { discussionId })
   * Room receives: { discussionId, rabbiId } (sender excluded)
   */
  socket.on('discussion:stopTyping', ({ discussionId } = {}) => {
    if (!discussionId) return;

    socket.to(`discussion:${discussionId}`).emit('discussion:stopTyping', {
      discussionId,
      rabbiId,
    });
  });

  // ── discussion:message (client-initiated path) ─────────────────────────────

  /**
   * Client sends a discussion message directly over the socket.
   * The preferred production path is via the REST API (which persists first,
   * then calls emitNewMessage), but this handler supports direct socket usage.
   *
   * Client sends:  socket.emit('discussion:message', { discussionId, message })
   * Room receives: discussion:message event with sender info merged in
   */
  socket.on('discussion:message', ({ discussionId, message } = {}) => {
    if (!discussionId || !message) return;

    emitToDiscussion(io, discussionId, 'discussion:message', {
      discussionId,
      message: {
        ...message,
        rabbiId,
        rabbiName,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ── discussion:messageEdited ───────────────────────────────────────────────

  /**
   * Message was edited.
   *
   * Client sends:  socket.emit('discussion:messageEdited', { discussionId, messageId, content })
   */
  socket.on('discussion:messageEdited', ({ discussionId, messageId, content } = {}) => {
    if (!discussionId || !messageId) return;

    emitToDiscussion(io, discussionId, 'discussion:messageEdited', {
      discussionId,
      messageId,
      content,
      editedBy:  rabbiId,
      editedAt:  new Date().toISOString(),
    });
  });

  // ── discussion:messagePinned ───────────────────────────────────────────────

  /**
   * Message was pinned or unpinned.
   *
   * Client sends:  socket.emit('discussion:messagePinned', { discussionId, messageId, pinned })
   */
  socket.on('discussion:messagePinned', ({ discussionId, messageId, pinned } = {}) => {
    if (!discussionId || !messageId || typeof pinned !== 'boolean') return;

    emitToDiscussion(io, discussionId, 'discussion:messagePinned', {
      discussionId,
      messageId,
      pinned,
      pinnedBy:  rabbiId,
      timestamp: new Date().toISOString(),
    });
  });

  // ── discussion:reaction ────────────────────────────────────────────────────

  /**
   * Emoji reaction added or removed.
   *
   * Client sends:  socket.emit('discussion:reaction', { discussionId, messageId, emoji, action })
   */
  socket.on('discussion:reaction', ({ discussionId, messageId, emoji, action } = {}) => {
    if (!discussionId || !messageId || !emoji || !['add', 'remove'].includes(action)) return;

    emitToDiscussion(io, discussionId, 'discussion:reaction', {
      discussionId,
      messageId,
      emoji,
      action,
      rabbiId,
      timestamp: new Date().toISOString(),
    });
  });
}

// ─── Server-push helpers (called from routes / services) ──────────────────────

/**
 * Push a newly persisted message to all members of a discussion room.
 *
 * Event:   discussion:message
 * Payload: { discussionId, message }
 *
 * @param {import('socket.io').Server} io           - Socket.io server instance
 * @param {string}                     discussionId - Discussion ID
 * @param {object}                     message      - Full message object from DB
 */
function emitNewMessage(io, discussionId, message) {
  emitToDiscussion(io, discussionId, 'discussion:message', {
    discussionId,
    message,
  });
}

/**
 * Notify room members that a message was edited.
 *
 * Event:   discussion:messageEdited
 * Payload: { discussionId, messageId, newContent, editedAt }
 *
 * @param {import('socket.io').Server} io           - Socket.io server instance
 * @param {string}                     discussionId - Discussion ID
 * @param {string}                     messageId    - Message ID
 * @param {string}                     newContent   - Updated message content
 */
function emitMessageEdited(io, discussionId, messageId, newContent) {
  emitToDiscussion(io, discussionId, 'discussion:messageEdited', {
    discussionId,
    messageId,
    newContent,
    editedAt: new Date().toISOString(),
  });
}

/**
 * Notify room members that a message was pinned or unpinned.
 *
 * Event:   discussion:messagePinned
 * Payload: { discussionId, messageId, isPinned, timestamp }
 *
 * @param {import('socket.io').Server} io           - Socket.io server instance
 * @param {string}                     discussionId - Discussion ID
 * @param {string}                     messageId    - Message ID
 * @param {boolean}                    isPinned     - New pinned state
 */
function emitMessagePinned(io, discussionId, messageId, isPinned) {
  emitToDiscussion(io, discussionId, 'discussion:messagePinned', {
    discussionId,
    messageId,
    isPinned,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Notify room members that emoji reactions on a message were updated.
 *
 * Event:   discussion:reaction
 * Payload: { discussionId, messageId, reactions, timestamp }
 *
 * @param {import('socket.io').Server} io           - Socket.io server instance
 * @param {string}                     discussionId - Discussion ID
 * @param {string}                     messageId    - Message ID
 * @param {object}                     reactions    - Full reactions map (emoji → count / rabbiIds)
 */
function emitReactionUpdate(io, discussionId, messageId, reactions) {
  emitToDiscussion(io, discussionId, 'discussion:reaction', {
    discussionId,
    messageId,
    reactions,
    timestamp: new Date().toISOString(),
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Per-socket setup (called from handlers.js)
  attachDiscussionHandlers,

  // Server-push helpers (called from routes / services)
  emitNewMessage,
  emitMessageEdited,
  emitMessagePinned,
  emitReactionUpdate,
};

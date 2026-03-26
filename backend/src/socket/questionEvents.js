'use strict';

/**
 * Question-related Socket.io Events — questionEvents.js
 *
 * Two responsibilities:
 *
 *  1. Per-socket listeners (registerQuestionEvents) — attached in handlers.js
 *     on every new connection so a rabbi can subscribe to individual question
 *     rooms for fine-grained updates.
 *
 *  2. Broadcast helpers (exported functions) — called from route handlers and
 *     services to push question state changes to the appropriate rooms without
 *     needing access to an individual socket.
 */

const { emitToRabbi, emitToAll, emitToAdmins } = require('./helpers');

// ─── Per-socket listeners (attached once per connection) ──────────────────────

/**
 * Register question-related event listeners on an individual socket.
 * Called from handlers.js inside the 'connection' handler.
 *
 * @param {import('socket.io').Server} io     - Socket.io server instance
 * @param {import('socket.io').Socket} socket - The connected socket
 */
function registerQuestionEvents(io, socket) {
  const rabbiId = socket.data.rabbiId;

  /**
   * Allow a rabbi to subscribe to live updates for a specific question.
   * The client sends: socket.emit('question:subscribe', questionId)
   */
  socket.on('question:subscribe', (questionId) => {
    if (!questionId) return;
    socket.join(`question:${questionId}`);
    console.log(`[socket:question] Rabbi ${rabbiId} subscribed to question ${questionId}`);
  });

  /**
   * Allow a rabbi to unsubscribe from a specific question room.
   * The client sends: socket.emit('question:unsubscribe', questionId)
   */
  socket.on('question:unsubscribe', (questionId) => {
    if (!questionId) return;
    socket.leave(`question:${questionId}`);
    console.log(`[socket:question] Rabbi ${rabbiId} unsubscribed from question ${questionId}`);
  });
}

// ─── Broadcast helpers (called from services / routes) ────────────────────────

/**
 * Broadcast a new question to the all-rabbis room (and optionally to specific
 * rabbis when category-based routing is provided).
 *
 * Event:   question:new
 * Payload: { id, title, category, isUrgent, timestamp }
 *
 * @param {import('socket.io').Server} io         - Socket.io server instance
 * @param {object}                     question   - Question data
 * @param {string[]}                   [rabbiIds] - Specific rabbi IDs for category routing
 */
function broadcastNewQuestion(io, question, rabbiIds) {
  const payload = {
    id:        question.id,
    title:     question.title,
    category:  question.category_name || question.category || null,
    isUrgent:  question.urgency === 'urgent' || question.urgency === 'critical',
    urgency:   question.urgency,
    timestamp: new Date().toISOString(),
  };

  if (Array.isArray(rabbiIds) && rabbiIds.length > 0) {
    rabbiIds.forEach((id) => emitToRabbi(io, id, 'question:new', payload));
  } else {
    emitToAll(io, 'question:new', payload);
  }

  // Admins always receive new question events
  emitToAdmins(io, 'question:new', payload);

  console.log(`[socket:question] broadcastNewQuestion: id=${question.id}`);
}

/**
 * Notify all rabbis that a question has been claimed.
 * The notification is deliberately generic — it does not reveal who claimed it.
 *
 * Event:   question:claimed
 * Payload: { id, status, message, timestamp }
 *
 * @param {import('socket.io').Server} io              - Socket.io server instance
 * @param {string}                     questionId      - Question ID
 * @param {string}                     [excludeSocketId] - Socket to exclude (the claimant's own socket)
 */
function notifyQuestionClaimed(io, questionId, excludeSocketId) {
  const payload = {
    id: questionId,
    status: 'in_process',
    message:   'שאלה זו נלקחה לטיפול',
    timestamp: new Date().toISOString(),
  };

  if (excludeSocketId) {
    // Broadcast to room but skip the socket that triggered the claim
    io.to('all-rabbis').except(excludeSocketId).emit('question:claimed', payload);
  } else {
    emitToAll(io, 'question:claimed', payload);
  }

  console.log(`[socket:question] notifyQuestionClaimed: id=${questionId}`);
}

/**
 * Notify all rabbis that a question has been released back to the queue.
 *
 * Event:   question:released
 * Payload: { id, status, message, timestamp }
 *
 * @param {import('socket.io').Server} io         - Socket.io server instance
 * @param {string}                     questionId - Question ID
 */
function notifyQuestionReleased(io, questionId) {
  emitToAll(io, 'question:released', {
    id: questionId,
    status: 'pending',
    message:   'השאלה חזרה לתור',
    timestamp: new Date().toISOString(),
  });

  console.log(`[socket:question] notifyQuestionReleased: id=${questionId}`);
}

/**
 * Notify the answering rabbi's personal room that a question has been answered.
 * Also updates the global question room so any subscribed observers refresh.
 *
 * Event:   question:answered
 * Payload: { id, answerId, rabbiId, status, answered_at, timestamp }
 *
 * @param {import('socket.io').Server} io         - Socket.io server instance
 * @param {string}                     questionId - Question ID
 * @param {string}                     rabbiId    - Rabbi who answered
 * @param {string}                     [answerId] - Answer ID
 */
function notifyQuestionAnswered(io, questionId, rabbiId, answerId) {
  const payload = {
    id: questionId,
    answerId: answerId || null,
    rabbiId,
    status: 'answered',
    answered_at: new Date().toISOString(),
    timestamp: new Date().toISOString(),
  };

  // Emit to the rabbi's personal room
  emitToRabbi(io, rabbiId, 'question:answered', payload);

  // Also notify any subscriber watching this specific question
  io.to(`question:${questionId}`).emit('question:answered', payload);

  // Keep admins in the loop
  emitToAdmins(io, 'question:answered', payload);

  console.log(`[socket:question] notifyQuestionAnswered: id=${questionId} rabbi=${rabbiId}`);
}

/**
 * Notify both the source and target rabbis about a question transfer.
 *
 * Events emitted:
 *   question:transferred  → to fromRabbi's room  { questionId, direction:'outgoing', toRabbiId, question }
 *   question:transferred  → to toRabbi's room    { questionId, direction:'incoming', fromRabbiId, question }
 *   question:transferred  → to admins            { questionId, fromRabbiId, toRabbiId, question }
 *
 * @param {import('socket.io').Server} io          - Socket.io server instance
 * @param {string}                     fromRabbiId - Source rabbi ID
 * @param {string}                     toRabbiId   - Target rabbi ID
 * @param {object}                     question    - Question data
 */
function notifyQuestionTransferred(io, fromRabbiId, toRabbiId, question) {
  const timestamp = new Date().toISOString();

  emitToRabbi(io, fromRabbiId, 'question:transferred', {
    id: question.id,
    questionId: question.id,
    direction:  'outgoing',
    toRabbiId,
    question,
    timestamp,
  });

  emitToRabbi(io, toRabbiId, 'question:transferred', {
    id: question.id,
    questionId: question.id,
    direction:  'incoming',
    fromRabbiId,
    question,
    timestamp,
  });

  emitToAdmins(io, 'question:transferred', {
    id: question.id,
    questionId: question.id,
    fromRabbiId,
    toRabbiId,
    question,
    timestamp,
  });

  console.log(
    `[socket:question] notifyQuestionTransferred:` +
    ` id=${question.id} from=${fromRabbiId} to=${toRabbiId}`
  );
}

/**
 * Broadcast an urgent question alert to all connected rabbis.
 *
 * Event:   question:urgent
 * Payload: { id, title, category, isUrgent: true, urgency, message, timestamp }
 *
 * @param {import('socket.io').Server} io       - Socket.io server instance
 * @param {object}                     question - Question data
 */
function broadcastUrgentQuestion(io, question) {
  emitToAll(io, 'question:urgent', {
    id:        question.id,
    title:     question.title,
    category:  question.category_name || question.category || null,
    isUrgent:  true,
    urgency:   question.urgency,
    message:   'שאלה דחופה חדשה!',
    timestamp: new Date().toISOString(),
  });

  console.log(`[socket:question] broadcastUrgentQuestion: id=${question.id}`);
}

/**
 * Notify a specific rabbi that a thank-you was received for their answer.
 *
 * Event:   question:thankReceived
 * Payload: { questionId, thankCount, question, message, timestamp }
 *
 * @param {import('socket.io').Server} io         - Socket.io server instance
 * @param {string}                     rabbiId    - Rabbi who answered
 * @param {object}                     question   - Question data (id, title, …)
 * @param {number}                     thankCount - Updated total thank count
 */
function notifyThankReceived(io, rabbiId, question, thankCount) {
  emitToRabbi(io, rabbiId, 'question:thankReceived', {
    questionId: question.id || question,   // accept both object and bare ID
    question,
    thankCount,
    message:    'קיבלת תודה על תשובתך!',
    timestamp:  new Date().toISOString(),
  });

  console.log(
    `[socket:question] notifyThankReceived:` +
    ` rabbi=${rabbiId} question=${question.id || question} thankCount=${thankCount}`
  );
}

/**
 * Broadcast a generic question status change to all rabbis and admins.
 *
 * Event:   question:statusChanged
 * Payload: { questionId, newStatus, timestamp, …extra }
 *
 * @param {import('socket.io').Server} io         - Socket.io server instance
 * @param {string}                     questionId - Question ID
 * @param {string}                     newStatus  - New status value
 * @param {object}                     [extra]    - Additional data to merge into payload
 */
function broadcastStatusChange(io, questionId, newStatus, extra = {}) {
  const payload = {
    id: questionId,
    questionId,
    newStatus,
    status: newStatus,
    ...extra,
    timestamp: new Date().toISOString(),
  };

  emitToAll(io, 'question:statusChanged', payload);
  emitToAdmins(io, 'question:statusChanged', payload);

  console.log(
    `[socket:question] broadcastStatusChange:` +
    ` id=${questionId} status=${newStatus}`
  );
}

// ─── Legacy aliases (kept so existing callers in routes/services don't break) ─

/** @deprecated Use notifyQuestionClaimed */
const broadcastQuestionClaimed   = (io, questionId) => notifyQuestionClaimed(io, questionId);
/** @deprecated Use notifyQuestionReleased */
const broadcastQuestionReleased  = (io, questionId) => notifyQuestionReleased(io, questionId);
/** @deprecated Use broadcastStatusChange */
const broadcastStatusChanged     = (io, qId, status, extra) => broadcastStatusChange(io, qId, status, extra);
/** @deprecated Use notifyThankReceived with (io, rabbiId, question, thankCount) */
const notifyThankReceivedLegacy  = (io, rabbiId, questionId, message) =>
  notifyThankReceived(io, rabbiId, { id: questionId }, 0);

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Per-socket setup (called from handlers.js)
  registerQuestionEvents,

  // Spec-defined broadcast helpers (called from routes / services)
  broadcastNewQuestion,
  notifyQuestionClaimed,
  notifyQuestionReleased,
  notifyQuestionAnswered,
  notifyQuestionTransferred,
  broadcastUrgentQuestion,
  notifyThankReceived,
  broadcastStatusChange,

  // Legacy aliases for callers that use the old names
  broadcastQuestionClaimed,
  broadcastQuestionReleased,
  broadcastStatusChanged,
  broadcastQuestionAnswered: notifyQuestionAnswered,
  notifyThankReceivedLegacy,
};

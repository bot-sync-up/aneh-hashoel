'use strict';

/**
 * Discussions Router
 *
 * Mounted at: /api/discussions
 *
 * All routes require a valid Bearer JWT (`authenticate` middleware).
 *
 * Routes
 * ──────
 *   GET    /                              – list discussions I'm a member of
 *                                           (unread count + last message preview)
 *   GET    /all                           – all discussions; admin sees all,
 *                                           rabbi sees open or ones they're in
 *   POST   /                              – create discussion
 *                                           { title, questionId?, memberIds[] | 'all' }
 *   GET    /:id                           – discussion info + members + pinned messages
 *   POST   /:id/join                      – join an open discussion
 *   POST   /:id/leave                     – leave discussion
 *   POST   /:id/members                   – add member(s) (creator or admin)
 *                                           { rabbiIds[] | 'all' }
 *   DELETE /:id/members/:rabbiId          – remove member (creator or admin)
 *   GET    /:id/messages                  – paginated messages (cursor-based, 50/page)
 *   POST   /:id/messages                  – send message { content, parentId? }
 *   PUT    /:id/messages/:msgId           – edit own message { content }
 *   DELETE /:id/messages/:msgId           – soft-delete message
 *   POST   /:id/messages/:msgId/pin       – toggle pin (creator or admin)
 *   POST   /:id/messages/:msgId/react     – add/toggle emoji reaction { emoji }
 *   PUT    /:id/messages/read             – mark all messages as read
 *   DELETE /:id                           – close/archive discussion (creator or admin)
 */

const express = require('express');
const { body, query: qv, param, validationResult } = require('express-validator');

const { authenticate, requireAdmin } = require('../middleware/authenticate');

const {
  ALLOWED_EMOJIS,
  createDiscussion,
  getMyDiscussions,
  getAllDiscussions,
  getDiscussionDetail,
  closeDiscussion,
  deleteDiscussion,
  lockDiscussion,
  joinDiscussion,
  leaveDiscussion,
  addMembers,
  removeMember,
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  pinMessage,
  addReaction,
  markAsRead,
} = require('../services/discussionService');

const router = express.Router();

// Every discussion route requires authentication
router.use(authenticate);

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Thin async wrapper — forwards unhandled promise rejections to Express.
 * @param {Function} fn
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

/**
 * Check express-validator result; send 422 + first error and return true if invalid.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {boolean}
 */
function hasValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

/** Reusable :id UUID validator */
const validateDiscussionId = param('id')
  .isUUID()
  .withMessage('מזהה דיון אינו תקין');

/** Reusable :msgId UUID validator */
const validateMsgId = param('msgId')
  .isUUID()
  .withMessage('מזהה הודעה אינו תקין');

// ─── GET / — my discussions ───────────────────────────────────────────────────

/**
 * List all discussions the authenticated rabbi is a member of.
 * Returns unread count and a 120-char preview of the last message for each.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const discussions = await getMyDiscussions(req.rabbi.id);
    return res.json({ discussions });
  })
);

// ─── GET /all — all discussions ───────────────────────────────────────────────

/**
 * List all discussions with role-based filtering.
 *   - Admin : all discussions regardless of open/closed status.
 *   - Rabbi : open discussions OR those the rabbi is already a member of.
 */
router.get(
  '/all',
  asyncHandler(async (req, res) => {
    const discussions = await getAllDiscussions(req.rabbi.id, req.rabbi.role);
    return res.json({ discussions });
  })
);

// ─── POST / — create discussion ───────────────────────────────────────────────

/**
 * Create a new discussion.
 *
 * Body:
 *   title      {string}              required
 *   questionId {string}              optional — UUID of a linked question
 *   memberIds  {string[] | 'all'}   optional — specific rabbi IDs or the
 *                                   literal string 'all' to invite everyone
 *
 * The creator is always added as a member.
 */
router.post(
  '/',
  [
    body('title')
      .isString()
      .trim()
      .isLength({ min: 2, max: 255 })
      .withMessage('כותרת הדיון חייבת להכיל בין 2 ל-255 תווים'),
    body('questionId')
      .optional({ nullable: true })
      .isUUID()
      .withMessage('questionId חייב להיות UUID תקין'),
    body('memberIds')
      .optional()
      .custom((v) => {
        if (v === 'all') return true;
        if (Array.isArray(v)) return true;
        throw new Error("memberIds חייב להיות מערך של מזהים או המחרוזת 'all'");
      }),
  ],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const { title, questionId, memberIds } = req.body;

    const discussion = await createDiscussion(
      title,
      questionId || null,
      req.rabbi.id,
      memberIds !== undefined ? memberIds : [],
      req.app.get('io')
    );

    return res.status(201).json({ discussion, message: 'הדיון נוצר בהצלחה' });
  })
);

// ─── GET /:id — discussion detail ─────────────────────────────────────────────

/**
 * Get full discussion data: metadata, members list, pinned messages.
 * Also updates the authenticated rabbi's last_read_at.
 */
router.get(
  '/:id',
  [validateDiscussionId],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const discussion = await getDiscussionDetail(req.params.id, req.rabbi.id);
    return res.json({ discussion });
  })
);

// ─── POST /:id/join — join open discussion ────────────────────────────────────

/**
 * Join an open discussion.
 * Returns 400 if the discussion is closed.
 * Idempotent: already being a member is treated as success.
 */
router.post(
  '/:id/join',
  [validateDiscussionId],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    await joinDiscussion(req.params.id, req.rabbi.id, req.app.get('io'));
    return res.json({ message: 'הצטרפת לדיון בהצלחה' });
  })
);

// ─── POST /:id/leave — leave discussion ──────────────────────────────────────

/**
 * Leave a discussion.
 * The creator cannot leave — they should close the discussion instead.
 */
router.post(
  '/:id/leave',
  [validateDiscussionId],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    await leaveDiscussion(req.params.id, req.rabbi.id, req.app.get('io'));
    return res.json({ message: 'עזבת את הדיון בהצלחה' });
  })
);

// ─── POST /:id/members — add members ─────────────────────────────────────────

/**
 * Add one or more members to the discussion. Only creator or admin.
 *
 * Body:
 *   rabbiIds {string[] | 'all'}  required
 */
router.post(
  '/:id/members',
  [
    validateDiscussionId,
    body('rabbiIds')
      .exists()
      .withMessage('rabbiIds נדרש')
      .custom((v) => {
        if (v === 'all') return true;
        if (Array.isArray(v) && v.length > 0) return true;
        throw new Error("rabbiIds חייב להיות מערך לא ריק או המחרוזת 'all'");
      }),
  ],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const { rabbiIds } = req.body;
    const result = await addMembers(
      req.params.id,
      req.rabbi.id,
      rabbiIds,
      req.app.get('io')
    );

    return res.json({ added: result.added, message: 'החברים נוספו בהצלחה' });
  })
);

// ─── DELETE /:id/members/:rabbiId — remove member ────────────────────────────

/**
 * Remove a specific member from the discussion.
 *   - Creator or admin may remove any non-creator member.
 *   - A rabbi may remove themselves (same as leaving).
 *   - The discussion creator cannot be removed.
 */
router.delete(
  '/:id/members/:rabbiId',
  [
    validateDiscussionId,
    param('rabbiId').isUUID().withMessage('מזהה רב אינו תקין'),
  ],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const targetId = req.params.rabbiId;

    await removeMember(
      req.params.id,
      targetId,
      req.rabbi.id,
      req.rabbi.role,
      req.app.get('io')
    );

    const isSelf = String(targetId) === String(req.rabbi.id);
    return res.json({ message: isSelf ? 'עזבת את הדיון בהצלחה' : 'החבר הוסר מהדיון' });
  })
);

// ─── GET /:id/messages — paginated messages ───────────────────────────────────

/**
 * Fetch messages for a discussion (cursor-based pagination, newest first).
 * Default page size: 50. Maximum: 100.
 *
 * Query params:
 *   cursor  {string}  optional — message ID; returns messages older than this cursor
 *   limit   {number}  optional — default 50, max 100
 *
 * Each message includes:
 *   - rabbi info (name, photo)
 *   - reactions map { emoji: { count, reacted, rabbis[] } }
 *   - parent_message preview (or null)
 *   - is_deleted flag; deleted messages return content: null
 */
router.get(
  '/:id/messages',
  [
    validateDiscussionId,
    qv('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('limit חייב להיות בין 1 ל-100'),
  ],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const cursor = req.query.cursor || null;
    const limit  = parseInt(req.query.limit, 10) || 50;

    const result = await getMessages(req.params.id, req.rabbi.id, cursor, limit);
    return res.json(result);
  })
);

// ─── PUT /:id/messages/read — mark all messages as read ──────────────────────
//
// IMPORTANT: This route is declared BEFORE /:id/messages/:msgId so that the
// literal path segment "read" is not consumed by the :msgId parameter.

/**
 * Update the authenticated rabbi's last_read_at to NOW() for this discussion.
 * Resets the unread counter visible in discussion lists.
 */
router.put(
  '/:id/messages/read',
  [validateDiscussionId],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    await markAsRead(req.params.id, req.rabbi.id);
    return res.json({ message: 'הדיון סומן כנקרא' });
  })
);

// ─── POST /:id/messages — send message ───────────────────────────────────────

/**
 * Send a message in a discussion.
 * Content is sanitized server-side (HTML allow-list via sanitizeRichText).
 * Emits `discussion:message` to the Socket.io discussion room.
 * Triggers email notifications for offline members (fire-and-forget).
 *
 * Body:
 *   content   {string}  required — HTML or plain text
 *   parentId  {string}  optional — UUID of the message being quoted/replied to
 */
router.post(
  '/:id/messages',
  [
    validateDiscussionId,
    body('content')
      .isString()
      .trim()
      .isLength({ min: 1, max: 50000 })
      .withMessage('תוכן ההודעה חייב להכיל בין 1 ל-50,000 תווים'),
    body('parentId')
      .optional({ nullable: true })
      .isUUID()
      .withMessage('parentId חייב להיות UUID תקין'),
  ],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const { content, parentId } = req.body;

    const message = await sendMessage(
      req.params.id,
      req.rabbi.id,
      content,
      parentId || null,
      req.app.get('io')
    );

    return res.status(201).json({ message });
  })
);

// ─── PUT /:id/messages/:msgId — edit message ──────────────────────────────────

/**
 * Edit own message.
 * Marks is_edited = true and updates edited_at.
 * Emits `discussion:messageEdited` to the discussion room.
 *
 * Body:
 *   content {string}  required — new HTML/text content
 */
router.put(
  '/:id/messages/:msgId',
  [
    validateDiscussionId,
    validateMsgId,
    body('content')
      .isString()
      .trim()
      .isLength({ min: 1, max: 50000 })
      .withMessage('תוכן ההודעה חייב להכיל בין 1 ל-50,000 תווים'),
  ],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const message = await editMessage(
      req.params.msgId,
      req.rabbi.id,
      req.body.content,
      req.app.get('io')
    );

    return res.json({ message, text: 'ההודעה עודכנה בהצלחה' });
  })
);

// ─── DELETE /:id/messages/:msgId — soft-delete message ───────────────────────

/**
 * Soft-delete a message (sets deleted_at).
 * The message author may delete their own messages; admins may delete any message.
 * Deleted messages remain as a placeholder (content: null, is_deleted: true).
 * Emits `discussion:messageDeleted` to the discussion room.
 */
router.delete(
  '/:id/messages/:msgId',
  [validateDiscussionId, validateMsgId],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const deleted = await deleteMessage(
      req.params.msgId,
      req.rabbi.id,
      req.rabbi.role,
      req.app.get('io')
    );

    return res.json({ messageId: deleted.id, text: 'ההודעה נמחקה' });
  })
);

// ─── POST /:id/messages/:msgId/pin — toggle pin ───────────────────────────────

/**
 * Pin or unpin a message. Only the discussion creator or an admin.
 * Emits `discussion:messagePinned` to the discussion room.
 */
router.post(
  '/:id/messages/:msgId/pin',
  [validateDiscussionId, validateMsgId],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const message = await pinMessage(
      req.params.msgId,
      req.params.id,
      req.rabbi.id,
      req.app.get('io')
    );

    return res.json({
      message,
      text: message.is_pinned ? 'ההודעה הוצמדה' : 'ההצמדה בוטלה',
    });
  })
);

// ─── POST /:id/messages/:msgId/react — toggle reaction ───────────────────────

/**
 * Add or remove an emoji reaction on a message.
 * Toggles: if the rabbi already reacted with this emoji, the reaction is removed.
 * Emits `discussion:reaction` with updated counts and a `reacted` flag.
 *
 * Allowed emojis: 👍 📖 ✅ ❓ ⭐
 *
 * Body:
 *   emoji {string}  required — one of the five allowed emojis
 */
router.post(
  '/:id/messages/:msgId/react',
  [
    validateDiscussionId,
    validateMsgId,
    body('emoji')
      .isString()
      .custom((v) => {
        if (!ALLOWED_EMOJIS.has(v)) {
          throw new Error(`אמוג׳י לא מורשה. מותרים: ${[...ALLOWED_EMOJIS].join(' ')}`);
        }
        return true;
      }),
  ],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const result = await addReaction(
      req.params.msgId,
      req.rabbi.id,
      req.body.emoji,
      req.app.get('io')
    );

    return res.json({ reactions: result.reactions, action: result.action });
  })
);

// ─── PATCH /:id/lock — lock/unlock discussion ────────────────────────────────

/**
 * Lock or unlock a discussion.
 * When locked, no new messages can be sent.
 * Only the creator or an admin may call this.
 * Emits `discussion:locked` to the discussion room.
 *
 * Body:
 *   locked {boolean} optional — defaults to true (lock)
 */
router.patch(
  '/:id/lock',
  [validateDiscussionId],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const locked = req.body.locked !== false; // default to true
    const discussion = await lockDiscussion(
      req.params.id,
      req.rabbi.id,
      locked,
      req.app.get('io')
    );

    return res.json({
      discussion,
      message: locked ? 'הדיון ננעל' : 'הדיון שוחרר',
    });
  })
);

// ─── DELETE /:id/permanent — permanently delete discussion (admin only) ──────

/**
 * Permanently delete a discussion and all its data.
 * Admin only. Cascades to members, messages, reactions.
 */
router.delete(
  '/:id/permanent',
  [validateDiscussionId],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    if (req.rabbi.role !== 'admin') {
      return res.status(403).json({ error: 'רק מנהל מערכת יכול למחוק דיון לצמיתות' });
    }

    const discussion = await deleteDiscussion(
      req.params.id,
      req.rabbi.id,
      req.app.get('io')
    );

    return res.json({ discussion, message: 'הדיון נמחק לצמיתות' });
  })
);

// ─── DELETE /:id — close/archive discussion ───────────────────────────────────

/**
 * Close a discussion (sets is_open = false).
 * Only the creator or an admin may call this.
 * Emits `discussion:closed` to the discussion room.
 */
router.delete(
  '/:id',
  [validateDiscussionId],
  asyncHandler(async (req, res) => {
    if (hasValidationErrors(req, res)) return;

    const discussion = await closeDiscussion(
      req.params.id,
      req.rabbi.id,
      req.app.get('io')
    );

    return res.json({ discussion, message: 'הדיון נסגר' });
  })
);

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;

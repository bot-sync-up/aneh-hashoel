'use strict';

/**
 * Discussion Business Logic
 *
 * Manages discussion rooms (chat) between rabbis, optionally linked
 * to a specific question. Handles creation, membership, messaging,
 * reactions, pinning, and real-time socket event emission.
 */

const { query: dbQuery, withTransaction } = require('../db/pool');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Verify that the rabbi is a member of the given discussion.
 * Throws 403 if not a member, 404 if the discussion does not exist.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @param {object}        [db]  Optional pg client for transaction context
 * @returns {Promise<void>}
 */
async function verifyMembership(discussionId, rabbiId, db = { query: dbQuery }) {
  const { rows } = await db.query(
    `SELECT 1 FROM discussion_members
     WHERE discussion_id = $1 AND rabbi_id = $2`,
    [discussionId, rabbiId]
  );

  if (rows.length === 0) {
    // Check whether the discussion exists at all
    const { rows: disc } = await db.query(
      `SELECT 1 FROM discussions WHERE id = $1`,
      [discussionId]
    );

    if (disc.length === 0) {
      const e = new Error('דיון לא נמצא');
      e.status = 404;
      throw e;
    }

    const e = new Error('אין לך הרשאה לדיון זה');
    e.status = 403;
    throw e;
  }
}

/**
 * Verify that the rabbi is the discussion creator or an admin.
 * Throws 403 if not authorized.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @param {object}        [db]  Optional pg client for transaction context
 * @returns {Promise<void>}
 */
async function verifyAdminOrCreator(discussionId, rabbiId, db = { query: dbQuery }) {
  const { rows } = await db.query(
    `SELECT d.created_by, r.role
     FROM   discussions d
     JOIN   rabbis r ON r.id = $2
     WHERE  d.id = $1`,
    [discussionId, rabbiId]
  );

  if (rows.length === 0) {
    const e = new Error('דיון לא נמצא');
    e.status = 404;
    throw e;
  }

  const { created_by, role } = rows[0];
  if (String(created_by) !== String(rabbiId) && role !== 'admin') {
    const e = new Error('רק מנהל או יוצר הדיון יכולים לבצע פעולה זו');
    e.status = 403;
    throw e;
  }
}

// ─── createDiscussion ─────────────────────────────────────────────────────────

/**
 * Create a new discussion room, optionally linked to a question.
 * If memberRabbiIds is null/empty, all rabbis are added as members.
 *
 * @param {string}        title
 * @param {string|number} createdBy       Rabbi ID of the creator
 * @param {string|number} [questionId]    Optional linked question
 * @param {Array}         [memberRabbiIds] Specific members; null = all rabbis
 * @returns {Promise<object>}             The created discussion row
 */
async function createDiscussion(title, createdBy, questionId = null, memberRabbiIds = null) {
  if (!title || !title.trim()) {
    const e = new Error('כותרת הדיון נדרשת');
    e.status = 400;
    throw e;
  }

  return withTransaction(async (client) => {
    // Insert discussion
    const { rows } = await client.query(
      `INSERT INTO discussions (title, created_by, question_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title.trim(), createdBy, questionId]
    );

    const discussion = rows[0];

    // Determine members
    let memberIds;
    if (memberRabbiIds && memberRabbiIds.length > 0) {
      // Ensure the creator is always included
      const uniqueIds = [...new Set([String(createdBy), ...memberRabbiIds.map(String)])];
      memberIds = uniqueIds;
    } else {
      // Add all rabbis
      const { rows: allRabbis } = await client.query(
        `SELECT id FROM rabbis`
      );
      memberIds = allRabbis.map((r) => String(r.id));
    }

    // Bulk insert members
    if (memberIds.length > 0) {
      const values = memberIds
        .map((_, i) => `($1, $${i + 2})`)
        .join(', ');
      const params = [discussion.id, ...memberIds];

      await client.query(
        `INSERT INTO discussion_members (discussion_id, rabbi_id)
         VALUES ${values}
         ON CONFLICT DO NOTHING`,
        params
      );
    }

    discussion.member_count = memberIds.length;
    return discussion;
  });
}

// ─── getDiscussions ───────────────────────────────────────────────────────────

/**
 * List all discussions the rabbi is a member of, with last message preview,
 * unread count, and member count.
 *
 * @param {string|number} rabbiId
 * @returns {Promise<object[]>}
 */
async function getDiscussions(rabbiId) {
  const { rows } = await dbQuery(
    `SELECT
       d.id,
       d.title,
       d.question_id,
       d.created_by,
       d.created_at,
       d.updated_at,
       -- Member count
       (SELECT COUNT(*) FROM discussion_members dm2 WHERE dm2.discussion_id = d.id)::int AS member_count,
       -- Last message preview
       lm.content      AS last_message_content,
       lm.rabbi_id     AS last_message_rabbi_id,
       lm.created_at   AS last_message_at,
       lr.name         AS last_message_rabbi_name,
       -- Unread count: messages created after the member's last_read_at
       (
         SELECT COUNT(*)
         FROM   discussion_messages msg
         WHERE  msg.discussion_id = d.id
           AND  msg.created_at > COALESCE(dm.last_read_at, '1970-01-01')
           AND  msg.rabbi_id != $1
       )::int AS unread_count
     FROM discussions d
     JOIN discussion_members dm ON dm.discussion_id = d.id AND dm.rabbi_id = $1
     LEFT JOIN LATERAL (
       SELECT content, rabbi_id, created_at
       FROM   discussion_messages
       WHERE  discussion_id = d.id
       ORDER  BY created_at DESC
       LIMIT  1
     ) lm ON true
     LEFT JOIN rabbis lr ON lr.id = lm.rabbi_id
     ORDER BY COALESCE(lm.created_at, d.created_at) DESC`,
    [rabbiId]
  );

  return rows;
}

// ─── getDiscussionById ────────────────────────────────────────────────────────

/**
 * Get a single discussion by ID. Verifies the rabbi is a member.
 * Returns the discussion with its members list.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @returns {Promise<object>}
 */
async function getDiscussionById(discussionId, rabbiId) {
  await verifyMembership(discussionId, rabbiId);

  const { rows: discRows } = await dbQuery(
    `SELECT d.*, r.name AS creator_name
     FROM   discussions d
     LEFT JOIN rabbis r ON r.id = d.created_by
     WHERE  d.id = $1`,
    [discussionId]
  );

  if (discRows.length === 0) {
    const e = new Error('דיון לא נמצא');
    e.status = 404;
    throw e;
  }

  const discussion = discRows[0];

  // Fetch members
  const { rows: members } = await dbQuery(
    `SELECT r.id, r.name, r.email, r.photo_url, r.role, dm.joined_at
     FROM   discussion_members dm
     JOIN   rabbis r ON r.id = dm.rabbi_id
     WHERE  dm.discussion_id = $1
     ORDER  BY dm.joined_at ASC`,
    [discussionId]
  );

  discussion.members = members;

  // Update last_read_at for this rabbi
  await dbQuery(
    `UPDATE discussion_members
     SET    last_read_at = NOW()
     WHERE  discussion_id = $1 AND rabbi_id = $2`,
    [discussionId, rabbiId]
  );

  return discussion;
}

// ─── getMessages ──────────────────────────────────────────────────────────────

/**
 * Get paginated messages for a discussion, newest first.
 * Verifies the rabbi is a member.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @param {number}        [page=1]
 * @param {number}        [limit=50]
 * @returns {Promise<{ messages: object[], total: number, page: number, limit: number }>}
 */
async function getMessages(discussionId, rabbiId, page = 1, limit = 50) {
  await verifyMembership(discussionId, rabbiId);

  const offset = (page - 1) * limit;

  const [messagesResult, countResult] = await Promise.all([
    dbQuery(
      `SELECT
         m.id,
         m.discussion_id,
         m.rabbi_id,
         r.name     AS rabbi_name,
         r.photo_url AS rabbi_photo,
         m.content,
         m.quoted_message_id,
         m.pinned,
         m.reactions,
         m.edited_at,
         m.created_at
       FROM   discussion_messages m
       JOIN   rabbis r ON r.id = m.rabbi_id
       WHERE  m.discussion_id = $1
       ORDER  BY m.created_at DESC
       LIMIT  $2 OFFSET $3`,
      [discussionId, limit, offset]
    ),
    dbQuery(
      `SELECT COUNT(*)::int AS total
       FROM   discussion_messages
       WHERE  discussion_id = $1`,
      [discussionId]
    ),
  ]);

  // Update last_read_at
  await dbQuery(
    `UPDATE discussion_members
     SET    last_read_at = NOW()
     WHERE  discussion_id = $1 AND rabbi_id = $2`,
    [discussionId, rabbiId]
  );

  return {
    messages: messagesResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

// ─── sendMessage ──────────────────────────────────────────────────────────────

/**
 * Send a message in a discussion. Verifies membership, inserts the message,
 * and emits a socket event.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @param {string}        content
 * @param {string|number} [quotedMessageId]
 * @returns {Promise<object>}  The created message with rabbi info
 */
async function sendMessage(discussionId, rabbiId, content, quotedMessageId = null) {
  if (!content || !content.trim()) {
    const e = new Error('תוכן ההודעה נדרש');
    e.status = 400;
    throw e;
  }

  await verifyMembership(discussionId, rabbiId);

  const { rows } = await dbQuery(
    `INSERT INTO discussion_messages (discussion_id, rabbi_id, content, quoted_message_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [discussionId, rabbiId, content.trim(), quotedMessageId]
  );

  const message = rows[0];

  // Fetch rabbi info for the socket payload
  const { rows: rabbiRows } = await dbQuery(
    `SELECT name, photo_url FROM rabbis WHERE id = $1`,
    [rabbiId]
  );

  message.rabbi_name = rabbiRows[0]?.name || null;
  message.rabbi_photo = rabbiRows[0]?.photo_url || null;

  // Update discussion's updated_at
  await dbQuery(
    `UPDATE discussions SET updated_at = NOW() WHERE id = $1`,
    [discussionId]
  );

  return message;
}

// ─── editMessage ──────────────────────────────────────────────────────────────

/**
 * Edit a message. Only the message author can edit their own messages.
 *
 * @param {string|number} messageId
 * @param {string|number} rabbiId
 * @param {string}        newContent
 * @returns {Promise<object>}  The updated message
 */
async function editMessage(messageId, rabbiId, newContent) {
  if (!newContent || !newContent.trim()) {
    const e = new Error('תוכן ההודעה נדרש');
    e.status = 400;
    throw e;
  }

  const { rows } = await dbQuery(
    `SELECT id, rabbi_id, discussion_id FROM discussion_messages WHERE id = $1`,
    [messageId]
  );

  if (rows.length === 0) {
    const e = new Error('הודעה לא נמצאה');
    e.status = 404;
    throw e;
  }

  if (String(rows[0].rabbi_id) !== String(rabbiId)) {
    const e = new Error('ניתן לערוך רק הודעות שלך');
    e.status = 403;
    throw e;
  }

  const { rows: updated } = await dbQuery(
    `UPDATE discussion_messages
     SET    content = $1, edited_at = NOW()
     WHERE  id = $2
     RETURNING *`,
    [newContent.trim(), messageId]
  );

  return updated[0];
}

// ─── pinMessage ───────────────────────────────────────────────────────────────

/**
 * Toggle the pinned status of a message.
 * Only the discussion creator or an admin can pin/unpin.
 *
 * @param {string|number} messageId
 * @param {string|number} rabbiId
 * @returns {Promise<object>}  The updated message
 */
async function pinMessage(messageId, rabbiId) {
  const { rows } = await dbQuery(
    `SELECT id, discussion_id, pinned FROM discussion_messages WHERE id = $1`,
    [messageId]
  );

  if (rows.length === 0) {
    const e = new Error('הודעה לא נמצאה');
    e.status = 404;
    throw e;
  }

  const message = rows[0];

  // Verify the rabbi is admin or discussion creator
  await verifyAdminOrCreator(message.discussion_id, rabbiId);

  const newPinned = !message.pinned;

  const { rows: updated } = await dbQuery(
    `UPDATE discussion_messages
     SET    pinned = $1
     WHERE  id = $2
     RETURNING *`,
    [newPinned, messageId]
  );

  return updated[0];
}

// ─── addReaction ──────────────────────────────────────────────────────────────

/**
 * Add or remove a rabbi's reaction (emoji) on a message.
 * Reactions are stored as JSONB: { "emoji": ["rabbiId1", "rabbiId2"], ... }
 *
 * If the rabbi already reacted with the same emoji, the reaction is removed (toggle).
 *
 * @param {string|number} messageId
 * @param {string|number} rabbiId
 * @param {string}        emoji
 * @returns {Promise<{ reactions: object, action: string }>}
 */
async function addReaction(messageId, rabbiId, emoji) {
  if (!emoji) {
    const e = new Error('אימוג׳י נדרש');
    e.status = 400;
    throw e;
  }

  const { rows } = await dbQuery(
    `SELECT id, discussion_id, reactions FROM discussion_messages WHERE id = $1`,
    [messageId]
  );

  if (rows.length === 0) {
    const e = new Error('הודעה לא נמצאה');
    e.status = 404;
    throw e;
  }

  const message = rows[0];

  // Verify the rabbi is a member of the discussion
  await verifyMembership(message.discussion_id, rabbiId);

  const reactions = message.reactions || {};
  const rabbiIdStr = String(rabbiId);
  let action;

  if (!reactions[emoji]) {
    reactions[emoji] = [];
  }

  const idx = reactions[emoji].indexOf(rabbiIdStr);
  if (idx === -1) {
    // Add reaction
    reactions[emoji].push(rabbiIdStr);
    action = 'add';
  } else {
    // Remove reaction (toggle)
    reactions[emoji].splice(idx, 1);
    action = 'remove';
    // Clean up empty emoji arrays
    if (reactions[emoji].length === 0) {
      delete reactions[emoji];
    }
  }

  await dbQuery(
    `UPDATE discussion_messages
     SET    reactions = $1
     WHERE  id = $2`,
    [JSON.stringify(reactions), messageId]
  );

  return { reactions, action, discussion_id: message.discussion_id };
}

// ─── addMembers ───────────────────────────────────────────────────────────────

/**
 * Add new members to a discussion.
 * Only the creator or an admin can add members.
 *
 * @param {string|number}   discussionId
 * @param {string|number}   rabbiId       The rabbi performing the action
 * @param {Array<string|number>} newMemberIds
 * @returns {Promise<{ added: number }>}
 */
async function addMembers(discussionId, rabbiId, newMemberIds) {
  if (!newMemberIds || newMemberIds.length === 0) {
    const e = new Error('יש לציין לפחות חבר אחד להוספה');
    e.status = 400;
    throw e;
  }

  await verifyAdminOrCreator(discussionId, rabbiId);

  const values = newMemberIds
    .map((_, i) => `($1, $${i + 2})`)
    .join(', ');
  const params = [discussionId, ...newMemberIds];

  const { rowCount } = await dbQuery(
    `INSERT INTO discussion_members (discussion_id, rabbi_id)
     VALUES ${values}
     ON CONFLICT DO NOTHING`,
    params
  );

  return { added: rowCount, discussion_id: discussionId };
}

// ─── removeMembers ────────────────────────────────────────────────────────────

/**
 * Remove members from a discussion.
 * Only the creator or an admin can remove members.
 * The creator cannot be removed.
 *
 * @param {string|number}   discussionId
 * @param {string|number}   rabbiId       The rabbi performing the action
 * @param {Array<string|number>} memberIds
 * @returns {Promise<{ removed: number }>}
 */
async function removeMembers(discussionId, rabbiId, memberIds) {
  if (!memberIds || memberIds.length === 0) {
    const e = new Error('יש לציין לפחות חבר אחד להסרה');
    e.status = 400;
    throw e;
  }

  await verifyAdminOrCreator(discussionId, rabbiId);

  // Prevent removing the discussion creator
  const { rows: disc } = await dbQuery(
    `SELECT created_by FROM discussions WHERE id = $1`,
    [discussionId]
  );

  if (disc.length > 0 && memberIds.map(String).includes(String(disc[0].created_by))) {
    const e = new Error('לא ניתן להסיר את יוצר הדיון');
    e.status = 400;
    throw e;
  }

  const placeholders = memberIds.map((_, i) => `$${i + 2}`).join(', ');

  const { rowCount } = await dbQuery(
    `DELETE FROM discussion_members
     WHERE discussion_id = $1 AND rabbi_id IN (${placeholders})`,
    [discussionId, ...memberIds]
  );

  return { removed: rowCount, discussion_id: discussionId };
}

// ─── leaveDiscussion ──────────────────────────────────────────────────────────

/**
 * Remove the rabbi from the discussion (leave voluntarily).
 * The discussion creator cannot leave — they must delete the discussion or
 * transfer ownership.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @returns {Promise<void>}
 */
async function leaveDiscussion(discussionId, rabbiId) {
  // Verify membership first
  await verifyMembership(discussionId, rabbiId);

  // Prevent the creator from leaving
  const { rows } = await dbQuery(
    `SELECT created_by FROM discussions WHERE id = $1`,
    [discussionId]
  );

  if (rows.length > 0 && String(rows[0].created_by) === String(rabbiId)) {
    const e = new Error('יוצר הדיון אינו יכול לעזוב. ניתן למחוק את הדיון או להעביר בעלות');
    e.status = 400;
    throw e;
  }

  await dbQuery(
    `DELETE FROM discussion_members
     WHERE discussion_id = $1 AND rabbi_id = $2`,
    [discussionId, rabbiId]
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createDiscussion,
  getDiscussions,
  getDiscussionById,
  getMessages,
  sendMessage,
  editMessage,
  pinMessage,
  addReaction,
  addMembers,
  removeMembers,
  leaveDiscussion,
};

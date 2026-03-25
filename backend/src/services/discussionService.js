'use strict';

/**
 * Discussion Service
 *
 * Business logic for the real-time Discussion (chat) feature.
 * All DB interactions go through the shared pool; socket emissions
 * are delegated to callers (route handlers) so this service stays
 * transport-agnostic.
 *
 * DB schema (relevant columns):
 *   discussions         – id, title, question_id, created_by (rabbi_id),
 *                         is_open, created_at
 *   discussion_members  – discussion_id, rabbi_id, joined_at, last_read_at
 *   discussion_messages – id, discussion_id, rabbi_id, content (HTML sanitized),
 *                         parent_id (FK → self), is_pinned, is_edited,
 *                         edited_at, created_at, deleted_at
 *   message_reactions   – id, message_id, rabbi_id,
 *                         emoji (👍 📖 ✅ ❓ ⭐)
 */

const { query: dbQuery, withTransaction } = require('../db/pool');
const { sanitizeRichText }               = require('../utils/sanitize');
const { sendEmail }                      = require('./email');
const { createEmailHTML }                = require('../templates/emailBase');
const { connectedRabbis, emitToRabbi, emitToDiscussion } = require('../socket/helpers');

// ─── Allowed emoji set ────────────────────────────────────────────────────────

const ALLOWED_EMOJIS = new Set(['👍', '📖', '✅', '❓', '⭐']);

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Assert the rabbi is a member of the discussion.
 * Throws 403 if not a member; 404 if the discussion does not exist;
 * 410 if the discussion is closed/archived.
 *
 * @param {string|number}       discussionId
 * @param {string|number}       rabbiId
 * @param {import('pg').PoolClient} [db]  Optional pg client (transaction context)
 */
async function assertMember(discussionId, rabbiId, db) {
  const run = db ? (sql, p) => db.query(sql, p) : dbQuery;

  const { rows } = await run(
    `SELECT 1
     FROM   discussion_members dm
     JOIN   discussions d ON d.id = dm.discussion_id
     WHERE  dm.discussion_id = $1
       AND  dm.rabbi_id      = $2`,
    [discussionId, rabbiId]
  );

  if (rows.length === 0) {
    // Distinguish 404 / 410 / 403
    const { rows: exists } = await run(
      `SELECT is_open FROM discussions WHERE id = $1`,
      [discussionId]
    );

    if (exists.length === 0) {
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
 * Assert the rabbi is the discussion creator or a system admin.
 * Throws 403 if not authorized; 404 if the discussion does not exist.
 *
 * @param {string|number}       discussionId
 * @param {string|number}       rabbiId
 * @param {import('pg').PoolClient} [db]
 */
async function assertCreatorOrAdmin(discussionId, rabbiId, db) {
  const run = db ? (sql, p) => db.query(sql, p) : dbQuery;

  const { rows } = await run(
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

/**
 * Attach reactions summary and parent-message preview to each message row.
 * Also marks whether the current rabbi reacted to each emoji.
 * Mutates the passed array in place and returns it.
 *
 * @param {object[]}      messages
 * @param {string|number} currentRabbiId
 * @returns {Promise<object[]>}
 */
async function attachReactionsAndParent(messages, currentRabbiId) {
  if (messages.length === 0) return messages;

  const messageIds = messages.map((m) => m.id);
  const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(', ');

  // Fetch all reactions for this batch
  const { rows: reactionRows } = await dbQuery(
    `SELECT mr.message_id, mr.emoji, mr.rabbi_id, r.name AS rabbi_name
     FROM   message_reactions mr
     JOIN   rabbis r ON r.id = mr.rabbi_id
     WHERE  mr.message_id IN (${placeholders})`,
    messageIds
  );

  // Group reactions by message and emoji
  const reactionMap = {};
  for (const row of reactionRows) {
    if (!reactionMap[row.message_id]) reactionMap[row.message_id] = {};
    if (!reactionMap[row.message_id][row.emoji]) {
      reactionMap[row.message_id][row.emoji] = { count: 0, reacted: false, rabbis: [] };
    }
    reactionMap[row.message_id][row.emoji].count++;
    reactionMap[row.message_id][row.emoji].rabbis.push({ id: row.rabbi_id, name: row.rabbi_name });
    if (String(row.rabbi_id) === String(currentRabbiId)) {
      reactionMap[row.message_id][row.emoji].reacted = true;
    }
  }

  // Fetch parent messages (quoted/reply previews)
  const parentIds = [...new Set(
    messages.filter((m) => m.parent_id).map((m) => m.parent_id)
  )];
  const parentMap = {};

  if (parentIds.length > 0) {
    const qPlaceholders = parentIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: parentRows } = await dbQuery(
      `SELECT m.id, m.content, m.deleted_at, r.name AS rabbi_name
       FROM   discussion_messages m
       JOIN   rabbis r ON r.id = m.rabbi_id
       WHERE  m.id IN (${qPlaceholders})`,
      parentIds
    );
    for (const p of parentRows) {
      parentMap[p.id] = {
        id:         p.id,
        rabbi_name: p.rabbi_name,
        content:    p.deleted_at ? null : p.content,
        is_deleted: !!p.deleted_at,
      };
    }
  }

  for (const msg of messages) {
    msg.reactions      = reactionMap[msg.id] || {};
    msg.parent_message = msg.parent_id ? (parentMap[msg.parent_id] || null) : null;
  }

  return messages;
}

// ─── createDiscussion ─────────────────────────────────────────────────────────

/**
 * Create a new discussion, add the creator, then add specified members or
 * all active rabbis when memberIds === 'all'.
 *
 * Emits `discussion:created` to each invited rabbi individually.
 *
 * @param {string}               title
 * @param {string|number|null}   questionId    Optional linked question
 * @param {string|number}        createdBy     Creator rabbi ID
 * @param {Array<string|number>|'all'} memberIds  Specific IDs or 'all'
 * @param {import('socket.io').Server} [io]    Socket.io server (optional)
 * @returns {Promise<object>}    The created discussion row with member_count
 */
async function createDiscussion(title, questionId, createdBy, memberIds, io) {
  if (!title || !String(title).trim()) {
    const e = new Error('כותרת הדיון נדרשת');
    e.status = 400;
    throw e;
  }

  const allRabbis = memberIds === 'all';

  return withTransaction(async (client) => {
    // Insert discussion
    const { rows } = await client.query(
      `INSERT INTO discussions (title, created_by, question_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title.trim(), createdBy, questionId || null]
    );
    const discussion = rows[0];

    // Resolve final member list
    let finalMemberIds;
    if (allRabbis) {
      const { rows: allRabbiRows } = await client.query(
        `SELECT id FROM rabbis WHERE is_active = true OR role = 'admin'`
      );
      finalMemberIds = allRabbiRows.map((r) => String(r.id));
    } else {
      // Explicit list — always include the creator
      const ids = Array.isArray(memberIds) ? memberIds : [];
      const unique = new Set([String(createdBy), ...ids.map(String)]);
      finalMemberIds = [...unique];
    }

    // Bulk insert members
    if (finalMemberIds.length > 0) {
      const values = finalMemberIds
        .map((_, i) => `($1, $${i + 2})`)
        .join(', ');
      await client.query(
        `INSERT INTO discussion_members (discussion_id, rabbi_id)
         VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [discussion.id, ...finalMemberIds]
      );
    }

    discussion.member_count = finalMemberIds.length;

    // Emit socket notifications after transaction commits
    if (io) {
      finalMemberIds.forEach((memberId) => {
        if (String(memberId) !== String(createdBy)) {
          emitToRabbi(io, String(memberId), 'discussion:created', {
            discussionId: discussion.id,
            title:        discussion.title,
            createdBy,
            timestamp:    new Date().toISOString(),
          });
        }
      });
    }

    return discussion;
  });
}

// ─── getMyDiscussions ─────────────────────────────────────────────────────────

/**
 * List discussions the rabbi is a member of, with unread count and last
 * message preview (content truncated to 120 chars).
 *
 * @param {string|number} rabbiId
 * @returns {Promise<object[]>}
 */
async function getMyDiscussions(rabbiId) {
  const { rows } = await dbQuery(
    `SELECT
       d.id,
       d.title,
       d.question_id,
       d.created_by,
       d.is_open,
       d.created_at,
       (SELECT COUNT(*)::int FROM discussion_members dm2
        WHERE  dm2.discussion_id = d.id)                            AS member_count,
       lm.rabbi_id                                                   AS last_message_rabbi_id,
       lr.name                                                       AS last_message_rabbi_name,
       LEFT(lm.content, 120)                                         AS last_message_preview,
       lm.created_at                                                 AS last_message_at,
       COALESCE((
         SELECT COUNT(*)::int
         FROM   discussion_messages msg
         WHERE  msg.discussion_id = d.id
           AND  msg.deleted_at    IS NULL
           AND  msg.rabbi_id     != $1
           AND  msg.created_at   > COALESCE(dm.last_read_at, '-infinity'::timestamptz)
       ), 0)                                                         AS unread_count
     FROM   discussions d
     JOIN   discussion_members dm
            ON dm.discussion_id = d.id AND dm.rabbi_id = $1
     LEFT JOIN LATERAL (
       SELECT content, rabbi_id, created_at
       FROM   discussion_messages
       WHERE  discussion_id = d.id
         AND  deleted_at    IS NULL
       ORDER  BY created_at DESC
       LIMIT  1
     ) lm ON true
     LEFT JOIN rabbis lr ON lr.id = lm.rabbi_id
     ORDER  BY COALESCE(lm.created_at, d.created_at) DESC`,
    [rabbiId]
  );

  return rows;
}

// ─── getAllDiscussions ─────────────────────────────────────────────────────────

/**
 * List all discussions with role-based filtering:
 *   - Admin: all discussions
 *   - Rabbi: only open discussions OR ones they're a member of
 *
 * @param {string|number} rabbiId
 * @param {string}        role     'admin' | 'rabbi'
 * @returns {Promise<object[]>}
 */
async function getAllDiscussions(rabbiId, role) {
  const isAdmin = role === 'admin';

  const { rows } = await dbQuery(
    `SELECT
       d.id,
       d.title,
       d.question_id,
       d.created_by,
       d.is_open,
       d.created_at,
       (SELECT COUNT(*)::int FROM discussion_members dm2
        WHERE  dm2.discussion_id = d.id)  AS member_count,
       LEFT(lm.content, 120)              AS last_message_preview,
       lm.created_at                      AS last_message_at,
       (dm_me.rabbi_id IS NOT NULL)       AS is_member
     FROM   discussions d
     LEFT JOIN LATERAL (
       SELECT content, created_at
       FROM   discussion_messages
       WHERE  discussion_id = d.id
         AND  deleted_at    IS NULL
       ORDER  BY created_at DESC
       LIMIT  1
     ) lm ON true
     LEFT JOIN discussion_members dm_me
            ON dm_me.discussion_id = d.id AND dm_me.rabbi_id = $1
     WHERE  $2::boolean = true
        OR  d.is_open   = true
        OR  dm_me.rabbi_id IS NOT NULL
     ORDER  BY COALESCE(lm.created_at, d.created_at) DESC`,
    [rabbiId, isAdmin]
  );

  return rows;
}

// ─── getDiscussionDetail ──────────────────────────────────────────────────────

/**
 * Full discussion data for display: metadata + members list + pinned messages.
 * Also updates the caller's last_read_at.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @returns {Promise<object>}
 */
async function getDiscussionDetail(discussionId, rabbiId) {
  await assertMember(discussionId, rabbiId);

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

  // Members list
  const { rows: members } = await dbQuery(
    `SELECT r.id, r.name, r.email, r.photo_url, r.role,
            dm.joined_at, dm.last_read_at
     FROM   discussion_members dm
     JOIN   rabbis r ON r.id = dm.rabbi_id
     WHERE  dm.discussion_id = $1
     ORDER  BY dm.joined_at ASC`,
    [discussionId]
  );
  discussion.members = members;

  // Pinned messages
  const { rows: pinned } = await dbQuery(
    `SELECT m.id, m.content, m.created_at, m.is_edited, m.edited_at,
            r.id AS rabbi_id, r.name AS rabbi_name
     FROM   discussion_messages m
     JOIN   rabbis r ON r.id = m.rabbi_id
     WHERE  m.discussion_id = $1
       AND  m.is_pinned     = true
       AND  m.deleted_at    IS NULL
     ORDER  BY m.created_at ASC`,
    [discussionId]
  );
  discussion.pinned_messages = pinned;

  // Mark as read
  await dbQuery(
    `UPDATE discussion_members
     SET    last_read_at = NOW()
     WHERE  discussion_id = $1 AND rabbi_id = $2`,
    [discussionId, rabbiId]
  );

  return discussion;
}

// ─── joinDiscussion ───────────────────────────────────────────────────────────

/**
 * Allow a rabbi to join an open discussion.
 * Throws 400 if the discussion is closed; 409 if already a member.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<void>}
 */
async function joinDiscussion(discussionId, rabbiId, io) {
  const { rows: discRows } = await dbQuery(
    `SELECT id, is_open, title FROM discussions WHERE id = $1`,
    [discussionId]
  );

  if (discRows.length === 0) {
    const e = new Error('דיון לא נמצא');
    e.status = 404;
    throw e;
  }

  if (!discRows[0].is_open) {
    const e = new Error('לא ניתן להצטרף לדיון סגור');
    e.status = 400;
    throw e;
  }

  const { rowCount } = await dbQuery(
    `INSERT INTO discussion_members (discussion_id, rabbi_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [discussionId, rabbiId]
  );

  if (rowCount === 0) {
    // Already a member — treat as success (idempotent)
    return;
  }

  if (io) {
    emitToDiscussion(io, discussionId, 'discussion:memberJoined', {
      discussionId,
      rabbiId,
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── leaveDiscussion ──────────────────────────────────────────────────────────

/**
 * Allow a rabbi to leave a discussion.
 * The creator cannot leave their own discussion.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<void>}
 */
async function leaveDiscussion(discussionId, rabbiId, io) {
  const { rows: discRows } = await dbQuery(
    `SELECT created_by FROM discussions WHERE id = $1`,
    [discussionId]
  );

  if (discRows.length === 0) {
    const e = new Error('דיון לא נמצא');
    e.status = 404;
    throw e;
  }

  if (String(discRows[0].created_by) === String(rabbiId)) {
    const e = new Error('יוצר הדיון אינו יכול לעזוב — ניתן לסגור את הדיון במקום');
    e.status = 400;
    throw e;
  }

  const { rowCount } = await dbQuery(
    `DELETE FROM discussion_members
     WHERE discussion_id = $1 AND rabbi_id = $2`,
    [discussionId, rabbiId]
  );

  if (rowCount === 0) {
    const e = new Error('אינך חבר בדיון זה');
    e.status = 404;
    throw e;
  }

  if (io) {
    emitToDiscussion(io, discussionId, 'discussion:memberLeft', {
      discussionId,
      rabbiId,
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── addMembers ───────────────────────────────────────────────────────────────

/**
 * Add members to a discussion. Only creator or admin.
 * Pass `rabbiIds === 'all'` to add all currently active rabbis.
 *
 * Emits `discussion:invited` to each newly added rabbi.
 *
 * @param {string|number}             discussionId
 * @param {string|number}             requesterId
 * @param {Array<string|number>|'all'} rabbiIds
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<{ added: number, discussion_id: string|number }>}
 */
async function addMembers(discussionId, requesterId, rabbiIds, io) {
  await assertCreatorOrAdmin(discussionId, requesterId);

  const allRabbis = rabbiIds === 'all';
  let finalIds;

  if (allRabbis) {
    const { rows } = await dbQuery(
      `SELECT id FROM rabbis WHERE is_active = true OR role = 'admin'`
    );
    finalIds = rows.map((r) => String(r.id));
  } else {
    if (!Array.isArray(rabbiIds) || rabbiIds.length === 0) {
      const e = new Error('יש לציין לפחות רב אחד להוספה');
      e.status = 400;
      throw e;
    }
    finalIds = rabbiIds.map(String);
  }

  if (finalIds.length === 0) {
    return { added: 0, discussion_id: discussionId };
  }

  const values = finalIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  const { rowCount } = await dbQuery(
    `INSERT INTO discussion_members (discussion_id, rabbi_id)
     VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [discussionId, ...finalIds]
  );

  if (io && !allRabbis) {
    finalIds.forEach((memberId) => {
      if (String(memberId) !== String(requesterId)) {
        emitToRabbi(io, memberId, 'discussion:invited', {
          discussionId,
          invitedBy: requesterId,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  return { added: rowCount, discussion_id: discussionId };
}

// ─── removeMember ─────────────────────────────────────────────────────────────

/**
 * Remove a single member from a discussion.
 *   - A rabbi may always remove themselves (handled via leaveDiscussion).
 *   - Only creator or admin may remove others.
 *   - The discussion creator cannot be removed by anyone.
 *
 * @param {string|number} discussionId
 * @param {string|number} targetRabbiId
 * @param {string|number} requesterId
 * @param {string}        requesterRole  'admin' | 'rabbi'
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<void>}
 */
async function removeMember(discussionId, targetRabbiId, requesterId, requesterRole, io) {
  const isSelf = String(targetRabbiId) === String(requesterId);

  if (!isSelf) {
    await assertCreatorOrAdmin(discussionId, requesterId);
  }

  // Check the discussion exists and guard creator removal
  const { rows: discRows } = await dbQuery(
    `SELECT created_by FROM discussions WHERE id = $1`,
    [discussionId]
  );
  if (discRows.length === 0) {
    const e = new Error('דיון לא נמצא');
    e.status = 404;
    throw e;
  }

  if (String(discRows[0].created_by) === String(targetRabbiId)) {
    const e = new Error('לא ניתן להסיר את יוצר הדיון');
    e.status = 400;
    throw e;
  }

  const { rowCount } = await dbQuery(
    `DELETE FROM discussion_members
     WHERE discussion_id = $1 AND rabbi_id = $2`,
    [discussionId, targetRabbiId]
  );

  if (rowCount === 0) {
    const e = new Error('הרב אינו חבר בדיון זה');
    e.status = 404;
    throw e;
  }

  if (io) {
    emitToDiscussion(io, discussionId, 'discussion:memberRemoved', {
      discussionId,
      removedRabbiId: targetRabbiId,
      removedBy:      requesterId,
      isSelf,
      timestamp:      new Date().toISOString(),
    });

    if (!isSelf) {
      emitToRabbi(io, String(targetRabbiId), 'discussion:kicked', {
        discussionId,
        removedBy: requesterId,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

// ─── getMessages ──────────────────────────────────────────────────────────────

/**
 * Cursor-based paginated message fetch, newest-first.
 * Pass `cursor` (message ID) to get messages older than that cursor.
 * Includes reactions (with `reacted` flag for current rabbi) and parent message
 * preview per message. Automatically updates last_read_at.
 *
 * @param {string|number}      discussionId
 * @param {string|number}      rabbiId
 * @param {string|number|null} cursor   Last message ID received (optional)
 * @param {number}             [limit=50]
 * @returns {Promise<{ messages: object[], hasMore: boolean, nextCursor: string|null }>}
 */
async function getMessages(discussionId, rabbiId, cursor = null, limit = 50) {
  await assertMember(discussionId, rabbiId);

  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

  let rows;
  if (cursor) {
    ({ rows } = await dbQuery(
      `SELECT
         m.id, m.discussion_id, m.rabbi_id,
         r.name       AS rabbi_name,
         r.photo_url  AS rabbi_photo,
         CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.content END AS content,
         m.parent_id,
         m.is_pinned,
         m.is_edited,
         m.edited_at,
         m.created_at,
         (m.deleted_at IS NOT NULL) AS is_deleted
       FROM   discussion_messages m
       JOIN   rabbis r ON r.id = m.rabbi_id
       WHERE  m.discussion_id = $1
         AND  m.id < $2
       ORDER  BY m.created_at DESC, m.id DESC
       LIMIT  $3`,
      [discussionId, cursor, safeLimit + 1]
    ));
  } else {
    ({ rows } = await dbQuery(
      `SELECT
         m.id, m.discussion_id, m.rabbi_id,
         r.name       AS rabbi_name,
         r.photo_url  AS rabbi_photo,
         CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.content END AS content,
         m.parent_id,
         m.is_pinned,
         m.is_edited,
         m.edited_at,
         m.created_at,
         (m.deleted_at IS NOT NULL) AS is_deleted
       FROM   discussion_messages m
       JOIN   rabbis r ON r.id = m.rabbi_id
       WHERE  m.discussion_id = $1
       ORDER  BY m.created_at DESC, m.id DESC
       LIMIT  $2`,
      [discussionId, safeLimit + 1]
    ));
  }

  const hasMore = rows.length > safeLimit;
  if (hasMore) rows.pop();

  const nextCursor = hasMore && rows.length > 0
    ? String(rows[rows.length - 1].id)
    : null;

  await attachReactionsAndParent(rows, rabbiId);

  // Update last_read_at
  await dbQuery(
    `UPDATE discussion_members
     SET    last_read_at = NOW()
     WHERE  discussion_id = $1 AND rabbi_id = $2`,
    [discussionId, rabbiId]
  );

  return { messages: rows, hasMore, nextCursor };
}

// ─── sendMessage ──────────────────────────────────────────────────────────────

/**
 * Validate membership, sanitize HTML content, persist message, update
 * discussion updated_at, emit socket event, and return the full message
 * object (including rabbi info) ready for the HTTP response.
 *
 * @param {string|number}      discussionId
 * @param {string|number}      rabbiId
 * @param {string}             rawContent       Raw HTML from the client
 * @param {string|number|null} parentId         Optional parent message ID (for quotes/replies)
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object>}
 */
async function sendMessage(discussionId, rabbiId, rawContent, parentId, io) {
  if (!rawContent || !String(rawContent).trim()) {
    const e = new Error('תוכן ההודעה נדרש');
    e.status = 400;
    throw e;
  }

  await assertMember(discussionId, rabbiId);

  // Check if discussion is locked
  const { rows: lockCheck } = await dbQuery(
    `SELECT locked FROM discussions WHERE id = $1`,
    [discussionId]
  );
  if (lockCheck[0]?.locked) {
    const e = new Error('הדיון נעול — לא ניתן לשלוח הודעות');
    e.status = 403;
    throw e;
  }

  // Validate parentId belongs to the same discussion
  if (parentId) {
    const { rows: pRows } = await dbQuery(
      `SELECT id FROM discussion_messages
       WHERE id = $1 AND discussion_id = $2`,
      [parentId, discussionId]
    );
    if (pRows.length === 0) {
      const e = new Error('ההודעה שמצוטטת לא נמצאה בדיון זה');
      e.status = 400;
      throw e;
    }
  }

  const sanitized = sanitizeRichText(rawContent);
  if (!sanitized.trim()) {
    const e = new Error('תוכן ההודעה אינו תקין');
    e.status = 400;
    throw e;
  }

  const { rows } = await dbQuery(
    `INSERT INTO discussion_messages (discussion_id, rabbi_id, content, parent_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [discussionId, rabbiId, sanitized, parentId || null]
  );

  const message = rows[0];

  // Update discussion's updated_at (touch it to reflect recent activity)
  await dbQuery(
    `UPDATE discussions
     SET updated_at = NOW()
     WHERE id = $1`,
    [discussionId]
  ).catch(() => {
    // Column may not exist in all migrations — ignore silently
  });

  // Attach rabbi info
  const { rows: rabbiRows } = await dbQuery(
    `SELECT name, photo_url FROM rabbis WHERE id = $1`,
    [rabbiId]
  );
  message.rabbi_name  = rabbiRows[0]?.name      || null;
  message.rabbi_photo = rabbiRows[0]?.photo_url  || null;
  message.reactions   = {};
  message.parent_message = null;
  message.is_deleted  = false;

  // Attach parent message preview
  if (parentId) {
    const { rows: pRows } = await dbQuery(
      `SELECT m.id, m.content, m.deleted_at, r.name AS rabbi_name
       FROM   discussion_messages m
       JOIN   rabbis r ON r.id = m.rabbi_id
       WHERE  m.id = $1`,
      [parentId]
    );
    if (pRows[0]) {
      message.parent_message = {
        id:         pRows[0].id,
        rabbi_name: pRows[0].rabbi_name,
        content:    pRows[0].deleted_at ? null : pRows[0].content,
        is_deleted: !!pRows[0].deleted_at,
      };
    }
  }

  // Emit to discussion room
  if (io) {
    emitToDiscussion(io, String(discussionId), 'discussion:message', {
      discussionId: String(discussionId),
      message,
      timestamp: new Date().toISOString(),
    });

    // Email offline members — fire-and-forget
    notifyOfflineMembers(discussionId, message).catch((err) => {
      console.error('[discussionService] notifyOfflineMembers failed:', err.message);
    });
  }

  return message;
}

// ─── editMessage ──────────────────────────────────────────────────────────────

/**
 * Edit own message. Marks is_edited = true and sets edited_at.
 * Emits `discussion:messageEdited` to the discussion room.
 *
 * @param {string|number} messageId
 * @param {string|number} rabbiId
 * @param {string}        rawContent
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object>}
 */
async function editMessage(messageId, rabbiId, rawContent, io) {
  if (!rawContent || !String(rawContent).trim()) {
    const e = new Error('תוכן ההודעה נדרש');
    e.status = 400;
    throw e;
  }

  const { rows } = await dbQuery(
    `SELECT id, rabbi_id, discussion_id, deleted_at, created_at
     FROM   discussion_messages
     WHERE  id = $1`,
    [messageId]
  );

  if (rows.length === 0) {
    const e = new Error('הודעה לא נמצאה');
    e.status = 404;
    throw e;
  }

  const msg = rows[0];

  if (String(msg.rabbi_id) !== String(rabbiId)) {
    const e = new Error('ניתן לערוך רק הודעות שלך');
    e.status = 403;
    throw e;
  }

  if (msg.deleted_at) {
    const e = new Error('לא ניתן לערוך הודעה שנמחקה');
    e.status = 400;
    throw e;
  }

  const sanitized = sanitizeRichText(rawContent);
  if (!sanitized.trim()) {
    const e = new Error('תוכן ההודעה אינו תקין');
    e.status = 400;
    throw e;
  }

  const { rows: updated } = await dbQuery(
    `UPDATE discussion_messages
     SET    content   = $1,
            is_edited = true,
            edited_at = NOW()
     WHERE  id = $2
     RETURNING *`,
    [sanitized, messageId]
  );

  const updatedMsg = updated[0];

  if (io) {
    emitToDiscussion(io, String(msg.discussion_id), 'discussion:messageEdited', {
      discussionId: String(msg.discussion_id),
      messageId:    updatedMsg.id,
      content:      updatedMsg.content,
      editedBy:     rabbiId,
      editedAt:     updatedMsg.edited_at,
      timestamp:    new Date().toISOString(),
    });
  }

  return updatedMsg;
}

// ─── deleteMessage ────────────────────────────────────────────────────────────

/**
 * Soft-delete a message (sets deleted_at). The message author or an admin.
 * Emits `discussion:messageDeleted` to the discussion room.
 *
 * @param {string|number} messageId
 * @param {string|number} rabbiId
 * @param {string}        role     'admin' | 'rabbi'
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object>}
 */
async function deleteMessage(messageId, rabbiId, role, io) {
  const { rows } = await dbQuery(
    `SELECT id, rabbi_id, discussion_id, deleted_at
     FROM   discussion_messages
     WHERE  id = $1`,
    [messageId]
  );

  if (rows.length === 0) {
    const e = new Error('הודעה לא נמצאה');
    e.status = 404;
    throw e;
  }

  const msg = rows[0];

  if (msg.deleted_at) {
    const e = new Error('ההודעה כבר נמחקה');
    e.status = 400;
    throw e;
  }

  if (String(msg.rabbi_id) !== String(rabbiId) && role !== 'admin') {
    const e = new Error('ניתן למחוק רק הודעות שלך');
    e.status = 403;
    throw e;
  }

  const { rows: updated } = await dbQuery(
    `UPDATE discussion_messages
     SET    deleted_at = NOW()
     WHERE  id = $1
     RETURNING id, discussion_id, deleted_at`,
    [messageId]
  );

  if (io) {
    emitToDiscussion(io, String(msg.discussion_id), 'discussion:messageDeleted', {
      discussionId: String(msg.discussion_id),
      messageId:    updated[0].id,
      placeholder:  'הודעה נמחקה',
      deletedBy:    rabbiId,
      timestamp:    new Date().toISOString(),
    });
  }

  return updated[0];
}

// ─── pinMessage ───────────────────────────────────────────────────────────────

/**
 * Toggle the pinned status of a message. Only creator or admin.
 * Emits `discussion:messagePinned` to the discussion room.
 *
 * @param {string|number} messageId
 * @param {string|number} discussionId
 * @param {string|number} actorId
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object>}
 */
async function pinMessage(messageId, discussionId, actorId, io) {
  await assertCreatorOrAdmin(discussionId, actorId);

  const { rows } = await dbQuery(
    `SELECT id, is_pinned, deleted_at
     FROM   discussion_messages
     WHERE  id = $1 AND discussion_id = $2`,
    [messageId, discussionId]
  );

  if (rows.length === 0) {
    const e = new Error('הודעה לא נמצאה');
    e.status = 404;
    throw e;
  }

  if (rows[0].deleted_at) {
    const e = new Error('לא ניתן להצמיד הודעה שנמחקה');
    e.status = 400;
    throw e;
  }

  const newPinned = !rows[0].is_pinned;

  const { rows: updated } = await dbQuery(
    `UPDATE discussion_messages
     SET    is_pinned = $1
     WHERE  id = $2
     RETURNING *`,
    [newPinned, messageId]
  );

  const updatedMsg = updated[0];

  if (io) {
    emitToDiscussion(io, String(discussionId), 'discussion:messagePinned', {
      discussionId: String(discussionId),
      messageId:    updatedMsg.id,
      isPinned:     updatedMsg.is_pinned,
      pinnedBy:     actorId,
      timestamp:    new Date().toISOString(),
    });
  }

  return updatedMsg;
}

// ─── addReaction ──────────────────────────────────────────────────────────────

/**
 * Add or toggle-off an emoji reaction on a message.
 * Only emojis from ALLOWED_EMOJIS are accepted.
 * Emits `discussion:reaction` to the discussion room with updated counts
 * and a `reacted` flag indicating whether the current rabbi reacted.
 *
 * @param {string|number} messageId
 * @param {string|number} rabbiId
 * @param {string}        emoji
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<{ action: 'added'|'removed', reactions: object, message_id, discussion_id }>}
 */
async function addReaction(messageId, rabbiId, emoji, io) {
  if (!emoji) {
    const e = new Error('יש לציין אמוג׳י');
    e.status = 400;
    throw e;
  }

  if (!ALLOWED_EMOJIS.has(emoji)) {
    const e = new Error(
      `אמוג׳י לא מורשה. מותרים: ${[...ALLOWED_EMOJIS].join(' ')}`
    );
    e.status = 400;
    throw e;
  }

  // Verify the message exists and get its discussion
  const { rows: msgRows } = await dbQuery(
    `SELECT id, discussion_id, deleted_at FROM discussion_messages WHERE id = $1`,
    [messageId]
  );

  if (msgRows.length === 0) {
    const e = new Error('הודעה לא נמצאה');
    e.status = 404;
    throw e;
  }

  if (msgRows[0].deleted_at) {
    const e = new Error('לא ניתן להגיב על הודעה שנמחקה');
    e.status = 400;
    throw e;
  }

  const discussionId = msgRows[0].discussion_id;
  await assertMember(discussionId, rabbiId);

  // Toggle reaction
  const { rows: existing } = await dbQuery(
    `SELECT id FROM message_reactions
     WHERE  message_id = $1 AND rabbi_id = $2 AND emoji = $3`,
    [messageId, rabbiId, emoji]
  );

  let action;
  if (existing.length > 0) {
    await dbQuery(
      `DELETE FROM message_reactions
       WHERE message_id = $1 AND rabbi_id = $2 AND emoji = $3`,
      [messageId, rabbiId, emoji]
    );
    action = 'removed';
  } else {
    await dbQuery(
      `INSERT INTO message_reactions (message_id, rabbi_id, emoji) VALUES ($1, $2, $3)`,
      [messageId, rabbiId, emoji]
    );
    action = 'added';
  }

  // Rebuild reactions summary with reacted flag
  const { rows: allReactions } = await dbQuery(
    `SELECT mr.emoji, mr.rabbi_id, r.name AS rabbi_name
     FROM   message_reactions mr
     JOIN   rabbis r ON r.id = mr.rabbi_id
     WHERE  mr.message_id = $1`,
    [messageId]
  );

  const reactions = {};
  for (const row of allReactions) {
    if (!reactions[row.emoji]) {
      reactions[row.emoji] = { count: 0, reacted: false, rabbis: [] };
    }
    reactions[row.emoji].count++;
    reactions[row.emoji].rabbis.push({ id: row.rabbi_id, name: row.rabbi_name });
    if (String(row.rabbi_id) === String(rabbiId)) {
      reactions[row.emoji].reacted = true;
    }
  }

  if (io) {
    emitToDiscussion(io, String(discussionId), 'discussion:reaction', {
      discussionId: String(discussionId),
      messageId,
      emoji,
      action,
      rabbiId,
      reactions,
      timestamp: new Date().toISOString(),
    });
  }

  return { action, reactions, message_id: messageId, discussion_id: discussionId };
}

// ─── getUnreadCount ───────────────────────────────────────────────────────────

/**
 * Count unread messages for a rabbi in a specific discussion.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @returns {Promise<number>}
 */
async function getUnreadCount(discussionId, rabbiId) {
  const { rows } = await dbQuery(
    `SELECT COUNT(*)::int AS cnt
     FROM   discussion_messages m
     JOIN   discussion_members dm
            ON dm.discussion_id = m.discussion_id
            AND dm.rabbi_id     = $2
     WHERE  m.discussion_id = $1
       AND  m.deleted_at    IS NULL
       AND  m.rabbi_id     != $2
       AND  m.created_at   > COALESCE(dm.last_read_at, '-infinity'::timestamptz)`,
    [discussionId, rabbiId]
  );
  return rows[0]?.cnt ?? 0;
}

// ─── markAsRead ───────────────────────────────────────────────────────────────

/**
 * Update last_read_at to NOW() for the rabbi in the given discussion.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @returns {Promise<void>}
 */
async function markAsRead(discussionId, rabbiId) {
  await assertMember(discussionId, rabbiId);

  await dbQuery(
    `UPDATE discussion_members
     SET    last_read_at = NOW()
     WHERE  discussion_id = $1 AND rabbi_id = $2`,
    [discussionId, rabbiId]
  );
}

// ─── closeDiscussion ──────────────────────────────────────────────────────────

/**
 * Close (archive) a discussion. Only creator or admin.
 * Sets is_open = false. Emits `discussion:closed` to the room.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object>}
 */
async function closeDiscussion(discussionId, rabbiId, io) {
  await assertCreatorOrAdmin(discussionId, rabbiId);

  const { rows } = await dbQuery(
    `UPDATE discussions
     SET    is_open = false
     WHERE  id = $1
     RETURNING *`,
    [discussionId]
  );

  if (rows.length === 0) {
    const e = new Error('דיון לא נמצא');
    e.status = 404;
    throw e;
  }

  const discussion = rows[0];

  if (io) {
    emitToDiscussion(io, String(discussionId), 'discussion:closed', {
      discussionId: String(discussionId),
      closedBy:     rabbiId,
      timestamp:    new Date().toISOString(),
    });
  }

  return discussion;
}

// ─── notifyOfflineMembers ─────────────────────────────────────────────────────

/**
 * Send an email notification to members who are NOT currently connected via
 * Socket.io, respecting their email_notifications preference.
 *
 * Fire-and-forget — errors are logged but NOT re-thrown.
 *
 * @param {string|number} discussionId
 * @param {object}        newMessage   The message object returned by sendMessage()
 * @returns {Promise<void>}
 */
async function notifyOfflineMembers(discussionId, newMessage) {
  try {
    const onlineIds = new Set(connectedRabbis.keys());

    const { rows: members } = await dbQuery(
      `SELECT r.id, r.name, r.email,
              COALESCE(r.email_notifications, true) AS wants_email
       FROM   discussion_members dm
       JOIN   rabbis r ON r.id = dm.rabbi_id
       WHERE  dm.discussion_id = $1
         AND  r.id != $2`,
      [discussionId, newMessage.rabbi_id]
    );

    const { rows: discRows } = await dbQuery(
      `SELECT title FROM discussions WHERE id = $1`,
      [discussionId]
    );
    const discussionTitle = discRows[0]?.title || 'דיון';
    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const discussionUrl = `${appUrl}/discussions/${discussionId}`;

    const emailJobs = members
      .filter((m) => !onlineIds.has(String(m.id)) && m.wants_email && m.email)
      .map(async (member) => {
        try {
          const senderName = newMessage.rabbi_name || 'רב';
          const preview = String(newMessage.content || '')
            .replace(/<[^>]+>/g, '')
            .slice(0, 140);

          const bodyContent = `
            <p style="margin: 0 0 12px; font-size: 15px;">שלום ${member.name || 'רב'},</p>
            <p style="margin: 0 0 12px; font-size: 15px;">
              הודעה חדשה מ<strong>${senderName}</strong> בדיון "<strong>${discussionTitle}</strong>":
            </p>
            <div style="
              background-color: #f8f8fb;
              border-right: 4px solid #B8973A;
              padding: 14px 18px;
              margin: 14px 0;
              border-radius: 4px;
              font-size: 14px;
              color: #333;
              line-height: 1.7;
            ">
              ${preview}${preview.length >= 140 ? '...' : ''}
            </div>
          `;

          const html = createEmailHTML('הודעה חדשה בדיון', bodyContent, [
            { label: 'פתח דיון', url: discussionUrl, color: '#1B2B5E' },
          ]);

          await sendEmail(
            member.email,
            `הודעה חדשה בדיון: ${discussionTitle}`,
            html
          );
        } catch (emailErr) {
          console.error(
            `[discussionService] Failed to send email to rabbi ${member.id}:`,
            emailErr.message
          );
        }
      });

    await Promise.allSettled(emailJobs);
  } catch (err) {
    console.error('[discussionService] notifyOfflineMembers error:', err.message);
  }
}

// ─── deleteDiscussion ─────────────────────────────────────────────────────────

/**
 * Permanently delete a discussion (admin only).
 * Cascades to members, messages, and reactions via FK ON DELETE CASCADE.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId     — must be admin
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object>}
 */
async function deleteDiscussion(discussionId, rabbiId, io) {
  // Verify admin role
  const { rows: rabbiRows } = await dbQuery(
    `SELECT role FROM rabbis WHERE id = $1`,
    [rabbiId]
  );

  if (!rabbiRows[0] || rabbiRows[0].role !== 'admin') {
    const e = new Error('רק מנהל מערכת יכול למחוק דיון');
    e.status = 403;
    throw e;
  }

  const { rows } = await dbQuery(
    `DELETE FROM discussions WHERE id = $1 RETURNING *`,
    [discussionId]
  );

  if (rows.length === 0) {
    const e = new Error('דיון לא נמצא');
    e.status = 404;
    throw e;
  }

  if (io) {
    emitToDiscussion(io, String(discussionId), 'discussion:deleted', {
      discussionId: String(discussionId),
      deletedBy: rabbiId,
    });
  }

  return rows[0];
}

// ─── lockDiscussion ──────────────────────────────────────────────────────────

/**
 * Lock a discussion — no more messages can be sent.
 * Only creator or admin may lock/unlock.
 *
 * @param {string|number} discussionId
 * @param {string|number} rabbiId
 * @param {boolean}       locked  — true to lock, false to unlock
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object>}
 */
async function lockDiscussion(discussionId, rabbiId, locked, io) {
  await assertCreatorOrAdmin(discussionId, rabbiId);

  const { rows } = await dbQuery(
    `UPDATE discussions
     SET    locked = $2
     WHERE  id = $1
     RETURNING *`,
    [discussionId, locked]
  );

  if (rows.length === 0) {
    const e = new Error('דיון לא נמצא');
    e.status = 404;
    throw e;
  }

  if (io) {
    emitToDiscussion(io, String(discussionId), 'discussion:locked', {
      discussionId: String(discussionId),
      locked,
      lockedBy: rabbiId,
    });
  }

  return rows[0];
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  ALLOWED_EMOJIS,

  // Discussion lifecycle
  createDiscussion,
  getMyDiscussions,
  getAllDiscussions,
  getDiscussionDetail,
  closeDiscussion,
  deleteDiscussion,
  lockDiscussion,

  // Membership
  joinDiscussion,
  leaveDiscussion,
  addMembers,
  removeMember,

  // Messages
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  pinMessage,

  // Reactions
  addReaction,

  // Read tracking
  getUnreadCount,
  markAsRead,

  // Notifications
  notifyOfflineMembers,

  // Exposed for testing / internal use
  assertMember,
  assertCreatorOrAdmin,
};

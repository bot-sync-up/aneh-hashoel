'use strict';

/**
 * wpService.js — WordPress REST API Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Bidirectional integration between our rabbi-side system and the WordPress
 * asker-side site via the WP REST API (wp-json/v2 and custom endpoints).
 *
 * Auth: Basic auth with WP_API_KEY (already base64-encoded application password
 *       in the form "username:app_password", or a raw application password that
 *       is base64-encoded here).  The header sent is:
 *         Authorization: Basic <base64(WP_API_KEY)>
 *       If WP_API_KEY already contains a colon it is assumed to be
 *       "user:password" and is base64-encoded as-is.  Otherwise the env var
 *       value itself is used as the pre-encoded credential.
 *
 * Error contract:
 *   Every exported function returns { success: boolean, data?, error? }.
 *   Nothing throws synchronously.  All HTTP errors are caught and classified:
 *     401  – logged + admin alert queued
 *     429  – exponential back-off + single retry
 *     5xx  – logged to wp_sync_log (audit_log table) for cron retry
 *
 * Environment variables:
 *   WP_API_URL  – Base URL of the WP REST API, e.g. https://site.com/wp-json/v2
 *   WP_API_KEY  – Application password or JWT (see Auth note above)
 *
 * Dependencies:
 *   axios             – HTTP client
 *   ../db/pool        – PostgreSQL pool (query helper)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');
const { query } = require('../db/pool');

// ─── Constants ────────────────────────────────────────────────────────────────

const RETRY_DELAY_BASE_MS = 2000; // initial back-off for 429
const REQUEST_TIMEOUT_MS  = 20000;

// ─── Axios client factory ────────────────────────────────────────────────────

/**
 * Build a pre-configured axios instance for the WP REST API.
 * Lazily constructed on each call so env vars are read at call time.
 *
 * @returns {import('axios').AxiosInstance}
 */
function buildClient() {
  const baseURL = process.env.WP_API_URL;
  const apiKey  = process.env.WP_API_KEY;

  if (!baseURL) {
    throw new Error('[wpService] WP_API_URL לא מוגדר');
  }
  if (!apiKey) {
    throw new Error('[wpService] WP_API_KEY לא מוגדר');
  }

  // If the key already contains a colon we treat it as "user:pass" and encode.
  // Otherwise we treat it as a pre-encoded token and pass directly.
  const credential = apiKey.includes(':')
    ? Buffer.from(apiKey).toString('base64')
    : apiKey;

  return axios.create({
    baseURL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credential}`,
    },
  });
}

// ─── Error classification helpers ────────────────────────────────────────────

/**
 * Classify an axios error and return a structured descriptor.
 *
 * @param {Error} err
 * @returns {{ httpStatus: number|null, message: string, isRetryable: boolean }}
 */
function classifyError(err) {
  const httpStatus = err.response?.status ?? null;
  const message    = err.response?.data?.message || err.message || String(err);
  const isRetryable = httpStatus === null || httpStatus >= 500; // network errors + 5xx
  return { httpStatus, message, isRetryable };
}

/**
 * Wait for `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with a single retry on 429.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string}           label  – For logging
 * @returns {Promise<T>}
 */
async function withRateLimitRetry(fn, label) {
  try {
    return await fn();
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfterSec = parseInt(err.response.headers['retry-after'] || '0', 10);
      const delay = retryAfterSec > 0
        ? retryAfterSec * 1000
        : RETRY_DELAY_BASE_MS;
      console.warn(
        `[wpService] 429 על ${label} — ממתין ${delay}ms לפני ניסיון נוסף`
      );
      await sleep(delay);
      return fn(); // one retry; if this also throws, bubble up
    }
    throw err;
  }
}

// ─── Sync log helper ─────────────────────────────────────────────────────────

/**
 * Write a sync event to the audit_log table (serves as wp_sync_log).
 *
 * @param {number|string|null} wpPostId
 * @param {string}             action   – e.g. 'publish_answer', 'get_questions'
 * @param {'success'|'failed'} status
 * @param {string|null}        [error]
 * @returns {Promise<void>}
 */
async function logSync(wpPostId, action, status, error = null) {
  try {
    await query(
      `INSERT INTO audit_log (action, entity_type, entity_id, new_value, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        `wp_sync:${action}`,
        'wp_post',
        wpPostId !== null && wpPostId !== undefined ? String(wpPostId) : null,
        JSON.stringify({ status, error: error || null, action }),
      ]
    );
  } catch (dbErr) {
    // Never let a logging failure surface to callers
    console.error('[wpService] logSync DB error:', dbErr.message);
  }
}

/**
 * Alert admin via console (can be extended to email/Slack in production).
 *
 * @param {string} message
 */
function alertAdmin(message) {
  console.error(`[wpService][ADMIN ALERT] ${message}`);
}

// ─── Exported API functions ───────────────────────────────────────────────────

/**
 * Fetch questions from WordPress that are not yet in our local DB.
 * Compares returned wp_post_id values against the questions table.
 *
 * Endpoint: GET /questions?status=pending&_fields=id,title,content,meta,date
 *
 * @returns {Promise<{ success: boolean, data?: object[], error?: string }>}
 */
async function getNewQuestions() {
  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.get('/ask-rabai', {
        params: {
          status:   'pending',
          _fields:  'id,title,meta,date,acf',
          per_page: 50,
          orderby:  'date',
          order:    'desc',
          context:  'edit',
        },
      }),
      'getNewQuestions'
    );

    const wpQuestions = response.data;

    if (!Array.isArray(wpQuestions) || wpQuestions.length === 0) {
      return { success: true, data: [] };
    }

    // Find which wp_post_ids are already in our DB
    const wpIds = wpQuestions.map((q) => q.id).filter(Boolean);

    const { rows: existingRows } = await query(
      `SELECT wp_post_id
       FROM   questions
       WHERE  wp_post_id = ANY($1::int[])`,
      [wpIds]
    );

    const existingSet = new Set(existingRows.map((r) => r.wp_post_id));
    const newQuestions = wpQuestions.filter((q) => !existingSet.has(q.id));

    console.log(
      `[wpService] getNewQuestions: ${wpQuestions.length} מ-WP, ` +
      `${newQuestions.length} חדשות (לא בDB)`
    );

    return { success: true, data: newQuestions };
  } catch (err) {
    const { httpStatus, message, isRetryable } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin('WP REST API החזיר 401 — בדוק את WP_API_KEY');
      await logSync(null, 'get_new_questions', 'failed', `401 Unauthorized: ${message}`);
    } else if (isRetryable) {
      await logSync(null, 'get_new_questions', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] getNewQuestions שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Fetch a single question from WordPress with all meta fields.
 *
 * Endpoint: GET /questions/{wpPostId}
 *
 * @param {number} wpPostId
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function getQuestionById(wpPostId) {
  if (!wpPostId) {
    return { success: false, error: 'wpPostId נדרש' };
  }

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.get(`/ask-rabai/${wpPostId}`, { params: { context: 'edit' } }),
      `getQuestionById(${wpPostId})`
    );

    return { success: true, data: response.data };
  } catch (err) {
    const { httpStatus, message, isRetryable } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin(`WP REST API החזיר 401 ב-getQuestionById(${wpPostId})`);
    } else if (httpStatus === 404) {
      console.warn(`[wpService] getQuestionById: wpPostId=${wpPostId} לא נמצא ב-WP`);
    } else if (isRetryable) {
      await logSync(wpPostId, 'get_question_by_id', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] getQuestionById(${wpPostId}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Update the status meta field of a WP question post.
 *
 * Endpoint: PATCH /questions/{wpPostId}  (meta.status)
 *
 * @param {number} wpPostId
 * @param {string} status   – e.g. 'pending', 'in_process', 'answered'
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function updateQuestionStatus(wpPostId, status) {
  if (!wpPostId || !status) {
    return { success: false, error: 'wpPostId ו-status נדרשים' };
  }

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.post(`/ask-rabai/${wpPostId}`, {
        meta: { status },
      }),
      `updateQuestionStatus(${wpPostId}, ${status})`
    );

    await logSync(wpPostId, 'update_status', 'success');
    console.log(`[wpService] updateQuestionStatus: wpPostId=${wpPostId} → status=${status}`);
    return { success: true, data: response.data };
  } catch (err) {
    const { httpStatus, message, isRetryable } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin(`WP REST API 401 ב-updateQuestionStatus(${wpPostId})`);
    }
    if (isRetryable) {
      await logSync(wpPostId, 'update_status', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] updateQuestionStatus(${wpPostId}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Publish a rabbi answer to the corresponding WP question post.
 * Sets answer content, rabbi name, signature, published timestamp, and
 * marks the WP post meta status as 'answered'.
 *
 * Endpoint: PATCH /questions/{wpPostId}
 *
 * @param {number} wpPostId
 * @param {{ content: string, rabbiName: string, signature?: string, publishedAt?: string }} answerData
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function publishAnswer(wpPostId, answerData) {
  if (!wpPostId) {
    return { success: false, error: 'wpPostId נדרש' };
  }
  if (!answerData?.content) {
    return { success: false, error: 'תוכן תשובה נדרש' };
  }

  const payload = {
    meta: {
      'ask-answ':        answerData.content,
      'ask-rabbi':       answerData.rabbiName   || '',
      'ask-signature':   answerData.signature   || '',
      'ask-answered-at': answerData.publishedAt || new Date().toISOString(),
    },
  };

  // If we have the WP category term ID, set it on the post
  if (answerData.wpCategoryTermId) {
    payload['ask-cat'] = [answerData.wpCategoryTermId];
  }

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.post(`/ask-rabai/${wpPostId}`, payload),
      `publishAnswer(${wpPostId})`
    );

    await logSync(wpPostId, 'publish_answer', 'success');
    console.log(`[wpService] publishAnswer ✓ wpPostId=${wpPostId} rabbi=${answerData.rabbiName}`);
    return { success: true, data: response.data };
  } catch (err) {
    const { httpStatus, message, isRetryable } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin(`WP REST API 401 ב-publishAnswer(${wpPostId})`);
    }
    if (isRetryable) {
      await logSync(wpPostId, 'publish_answer', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] publishAnswer(${wpPostId}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Append a follow-up answer to a WP question post.
 * Stores the content in a dedicated meta field and marks the post as having
 * a follow-up.
 *
 * Endpoint: PATCH /questions/{wpPostId}
 *
 * @param {number} wpPostId
 * @param {{ content: string, rabbiName?: string, publishedAt?: string }} followUpAnswer
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function publishFollowUpAnswer(wpPostId, followUpAnswer) {
  if (!wpPostId) {
    return { success: false, error: 'wpPostId נדרש' };
  }
  if (!followUpAnswer?.content) {
    return { success: false, error: 'תוכן תשובת המשך נדרש' };
  }

  const payload = {
    meta: {
      'ask-answ': followUpAnswer.content,
    },
  };

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.post(`/ask-rabai/${wpPostId}`, payload),
      `publishFollowUpAnswer(${wpPostId})`
    );

    await logSync(wpPostId, 'publish_followup_answer', 'success');
    console.log(`[wpService] publishFollowUpAnswer ✓ wpPostId=${wpPostId}`);
    return { success: true, data: response.data };
  } catch (err) {
    const { httpStatus, message, isRetryable } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin(`WP REST API 401 ב-publishFollowUpAnswer(${wpPostId})`);
    }
    if (isRetryable) {
      await logSync(wpPostId, 'publish_followup_answer', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] publishFollowUpAnswer(${wpPostId}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Trigger the WP-side custom REST endpoint that sends an email notification
 * to the asker that their question has been answered.
 *
 * Endpoint: POST /aneh/v1/notify-asker  (custom endpoint registered on WP)
 *
 * @param {number} wpPostId
 * @param {string} askerEmail
 * @param {string} answerUrl  – Full URL to the published answer on the WP site
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function notifyAskerEmail(wpPostId, askerEmail, answerUrl) {
  if (!wpPostId || !askerEmail) {
    return { success: false, error: 'wpPostId ו-askerEmail נדרשים' };
  }

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.post('/aneh/v1/notify-asker', {
        post_id:    wpPostId,
        email:      askerEmail,
        answer_url: answerUrl || '',
      }),
      `notifyAskerEmail(${wpPostId})`
    );

    await logSync(wpPostId, 'notify_asker_email', 'success');
    console.log(`[wpService] notifyAskerEmail ✓ wpPostId=${wpPostId} email=${askerEmail}`);
    return { success: true, data: response.data };
  } catch (err) {
    const { httpStatus, message, isRetryable } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin(`WP REST API 401 ב-notifyAskerEmail(${wpPostId})`);
    }
    if (isRetryable) {
      await logSync(wpPostId, 'notify_asker_email', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] notifyAskerEmail(${wpPostId}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Retrieve the asker's phone number from WP post meta.
 * Used downstream for WhatsApp notifications via GreenAPI.
 *
 * Endpoint: GET /questions/{wpPostId}  (reads meta.asker_phone)
 *
 * @param {number} wpPostId
 * @returns {Promise<{ success: boolean, phone?: string|null, error?: string }>}
 */
async function getAskerPhone(wpPostId) {
  if (!wpPostId) {
    return { success: false, error: 'wpPostId נדרש' };
  }

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.get(`/ask-rabai/${wpPostId}`, {
        params: { _fields: 'id,meta', context: 'edit' },
      }),
      `getAskerPhone(${wpPostId})`
    );

    const phone = response.data?.meta?.visitor_phone || response.data?.meta?.asker_phone || null;
    return { success: true, phone };
  } catch (err) {
    const { httpStatus, message, isRetryable } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin(`WP REST API 401 ב-getAskerPhone(${wpPostId})`);
    } else if (isRetryable) {
      await logSync(wpPostId, 'get_asker_phone', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] getAskerPhone(${wpPostId}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Create a new post in the "rabbi-of-week" Custom Post Type on WordPress.
 *
 * Endpoint: POST /rabbi-of-week  (custom CPT rest_base)
 *
 * @param {string} rabbiName
 * @param {{ answersCount?: number, avgResponseMin?: number, thankCount?: number, weekLabel?: string }} stats
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function postRabbiOfWeek(rabbiName, stats = {}) {
  if (!rabbiName) {
    return { success: false, error: 'שם הרב נדרש' };
  }

  const weekLabel = stats.weekLabel || _currentWeekLabel();

  const payload = {
    title:  `רב השבוע — ${rabbiName} (${weekLabel})`,
    status: 'publish',
    meta: {
      rabbi_name:         rabbiName,
      answers_count:      stats.answersCount   ?? 0,
      avg_response_min:   stats.avgResponseMin ?? 0,
      thank_count:        stats.thankCount     ?? 0,
      week_label:         weekLabel,
    },
  };

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.post('/rabbi-of-week', payload),
      `postRabbiOfWeek(${rabbiName})`
    );

    await logSync(null, 'post_rabbi_of_week', 'success');
    console.log(`[wpService] postRabbiOfWeek ✓ rabbi=${rabbiName} week=${weekLabel}`);
    return { success: true, data: response.data };
  } catch (err) {
    const { httpStatus, message, isRetryable } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin(`WP REST API 401 ב-postRabbiOfWeek(${rabbiName})`);
    }
    if (isRetryable) {
      await logSync(null, 'post_rabbi_of_week', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] postRabbiOfWeek(${rabbiName}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Retry all failed sync entries found in the audit_log (wp_sync_log) table.
 * Fetches up to 50 un-synced answered questions and re-attempts publishAnswer.
 *
 * @returns {Promise<{ success: boolean, total: number, succeeded: number, failed: number, error?: string }>}
 */
async function syncRetryFailed() {
  try {
    // Find answered questions that still need WP sync (wp_synced_at IS NULL)
    const { rows } = await query(
      `SELECT q.id,
              q.wp_post_id,
              a.content    AS answer_content,
              a.published_at,
              r.name       AS rabbi_name,
              r.signature  AS rabbi_signature
       FROM   questions q
       JOIN   answers   a ON a.question_id = q.id
       JOIN   rabbis    r ON r.id          = a.rabbi_id
       WHERE  q.status      = 'answered'
         AND  q.wp_synced_at IS NULL
         AND  q.wp_post_id  IS NOT NULL
       ORDER BY q.answered_at ASC
       LIMIT  50`
    );

    if (rows.length === 0) {
      console.info('[wpService] syncRetryFailed: אין ערכים כושלים לסנכרון חוזר');
      return { success: true, total: 0, succeeded: 0, failed: 0 };
    }

    console.info(`[wpService] syncRetryFailed: נמצאו ${rows.length} שאלות לניסיון חוזר`);

    let succeeded = 0;
    let failed    = 0;

    for (const row of rows) {
      const result = await publishAnswer(row.wp_post_id, {
        content:     row.answer_content,
        rabbiName:   row.rabbi_name,
        signature:   row.rabbi_signature || '',
        publishedAt: row.published_at?.toISOString() || new Date().toISOString(),
      });

      if (result.success) {
        // Mark wp_synced_at in our DB
        await query(
          `UPDATE questions
           SET    wp_synced_at = NOW(),
                  updated_at   = NOW()
           WHERE  id = $1`,
          [row.id]
        ).catch((dbErr) => {
          console.error(
            `[wpService] syncRetryFailed: שגיאה בעדכון wp_synced_at עבור ${row.id}:`,
            dbErr.message
          );
        });
        succeeded++;
      } else {
        failed++;
      }
    }

    console.info(
      `[wpService] syncRetryFailed: ${succeeded} הצליחו, ${failed} נכשלו מתוך ${rows.length}`
    );

    return { success: true, total: rows.length, succeeded, failed };
  } catch (err) {
    console.error('[wpService] syncRetryFailed שגיאה כללית:', err.message);
    return { success: false, total: 0, succeeded: 0, failed: 0, error: err.message };
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Return a human-readable ISO week label, e.g. "2026-W11".
 * @returns {string}
 */
function _currentWeekLabel() {
  const now  = new Date();
  const year = now.getFullYear();
  // Calculate ISO week number
  const startOfYear = new Date(year, 0, 1);
  const dayOfYear   = Math.floor((now - startOfYear) / 86400000) + 1;
  const weekNum     = Math.ceil(dayOfYear / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

// ─── getAttachmentUrl ─────────────────────────────────────────────────────────

/**
 * Resolve a WordPress attachment ID to its source URL.
 * @param {number|string} attachmentId
 * @returns {Promise<string|null>}
 */
async function getAttachmentUrl(attachmentId) {
  if (!attachmentId) return null;
  try {
    const client = buildClient();
    const response = await client.get(`/media/${attachmentId}`, {
      params: { _fields: 'source_url' },
    });
    return response.data?.source_url || null;
  } catch (_) {
    return null;
  }
}

// ─── syncThankCount ──────────────────────────────────────────────────────────

/**
 * Sync thank count to the corresponding WordPress post meta.
 *
 * Endpoint: PATCH /ask-rabai/{wpPostId} with meta: { ask_thank_count }
 *
 * @param {number} wpPostId
 * @param {number} thankCount
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function syncThankCount(wpPostId, thankCount) {
  if (!wpPostId) {
    return { success: false, error: 'wpPostId נדרש' };
  }

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.post(`/ask-rabai/${wpPostId}`, {
        meta: { ask_thank_count: thankCount },
      }),
      `syncThankCount(${wpPostId})`
    );

    console.log(`[wpService] syncThankCount ✓ wpPostId=${wpPostId} thankCount=${thankCount}`);
    return { success: true, data: response.data };
  } catch (err) {
    const { httpStatus, message } = classifyError(err);
    console.error(`[wpService] syncThankCount(${wpPostId}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

// ─── Category taxonomy (ask-cat) functions ──────────────────────────────────

/**
 * Fetch all WP category terms from the ask-cat taxonomy.
 *
 * Endpoint: GET /ask-cat?per_page=100
 *
 * @returns {Promise<{ success: boolean, data?: Array<{id: number, name: string, slug: string}>, error?: string }>}
 */
async function getWPCategories() {
  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.get('/ask-cat', {
        params: {
          per_page: 100,
          _fields:  'id,name,slug',
        },
      }),
      'getWPCategories'
    );

    const terms = response.data;

    if (!Array.isArray(terms)) {
      return { success: true, data: [] };
    }

    console.log(`[wpService] getWPCategories: ${terms.length} קטגוריות מ-WP`);
    return { success: true, data: terms };
  } catch (err) {
    const { httpStatus, message } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin('WP REST API החזיר 401 ב-getWPCategories');
    }

    console.error(`[wpService] getWPCategories שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Create a new term in the ask-cat taxonomy on WordPress.
 *
 * Endpoint: POST /ask-cat
 *
 * @param {string} name
 * @returns {Promise<{ success: boolean, data?: {id: number, name: string, slug: string}, error?: string }>}
 */
async function createWPCategory(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return { success: false, error: 'שם קטגוריה נדרש' };
  }

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.post('/ask-cat', { name: name.trim() }),
      `createWPCategory(${name})`
    );

    await logSync(null, 'create_wp_category', 'success');
    console.log(`[wpService] createWPCategory ✓ name=${name} wpTermId=${response.data?.id}`);
    return { success: true, data: response.data };
  } catch (err) {
    const { httpStatus, message } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin('WP REST API 401 ב-createWPCategory');
    }
    if (httpStatus >= 500 || httpStatus === null) {
      await logSync(null, 'create_wp_category', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] createWPCategory(${name}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Delete a term from the ask-cat taxonomy on WordPress.
 *
 * Endpoint: DELETE /ask-cat/{id}?force=true
 *
 * @param {number} wpTermId
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function deleteWPCategory(wpTermId) {
  if (!wpTermId) {
    return { success: false, error: 'wpTermId נדרש' };
  }

  try {
    const client = buildClient();

    await withRateLimitRetry(
      () => client.delete(`/ask-cat/${wpTermId}`, { params: { force: true } }),
      `deleteWPCategory(${wpTermId})`
    );

    await logSync(null, 'delete_wp_category', 'success');
    console.log(`[wpService] deleteWPCategory ✓ wpTermId=${wpTermId}`);
    return { success: true };
  } catch (err) {
    const { httpStatus, message } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin(`WP REST API 401 ב-deleteWPCategory(${wpTermId})`);
    }

    console.error(`[wpService] deleteWPCategory(${wpTermId}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

// ─── Rabbi taxonomy (rabi-add) functions ─────────────────────────────────────

/**
 * Fetch all WP rabbi terms from the rabi-add taxonomy.
 *
 * Endpoint: GET /rabi-add?per_page=100
 *
 * @returns {Promise<{ success: boolean, data?: Array<{id: number, name: string, slug: string}>, error?: string }>}
 */
async function getWPRabbis() {
  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.get('/rabi-add', {
        params: {
          per_page: 100,
          _fields:  'id,name,slug',
        },
      }),
      'getWPRabbis'
    );

    const terms = response.data;

    if (!Array.isArray(terms)) {
      return { success: true, data: [] };
    }

    console.log(`[wpService] getWPRabbis: ${terms.length} רבנים מ-WP`);
    return { success: true, data: terms };
  } catch (err) {
    const { httpStatus, message } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin('WP REST API החזיר 401 ב-getWPRabbis');
    }

    console.error(`[wpService] getWPRabbis שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

/**
 * Create a new term in the rabi-add taxonomy on WordPress.
 *
 * Endpoint: POST /rabi-add
 *
 * @param {string} name
 * @returns {Promise<{ success: boolean, data?: {id: number, name: string, slug: string}, error?: string }>}
 */
async function createWPRabbi(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return { success: false, error: 'שם הרב נדרש' };
  }

  try {
    const client = buildClient();

    const response = await withRateLimitRetry(
      () => client.post('/rabi-add', { name: name.trim() }),
      `createWPRabbi(${name})`
    );

    await logSync(null, 'create_wp_rabbi', 'success');
    console.log(`[wpService] createWPRabbi ✓ name=${name} wpTermId=${response.data?.id}`);
    return { success: true, data: response.data };
  } catch (err) {
    const { httpStatus, message } = classifyError(err);

    if (httpStatus === 401) {
      alertAdmin('WP REST API 401 ב-createWPRabbi');
    }
    if (httpStatus >= 500 || httpStatus === null) {
      await logSync(null, 'create_wp_rabbi', 'failed', `${httpStatus ?? 'network'}: ${message}`);
    }

    console.error(`[wpService] createWPRabbi(${name}) שגיאה (${httpStatus}):`, message);
    return { success: false, error: message };
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getNewQuestions,
  getAttachmentUrl,
  getQuestionById,
  updateQuestionStatus,
  publishAnswer,
  publishFollowUpAnswer,
  notifyAskerEmail,
  getAskerPhone,
  postRabbiOfWeek,
  syncRetryFailed,
  syncThankCount,
  logSync,
  // Category taxonomy (ask-cat)
  getWPCategories,
  createWPCategory,
  deleteWPCategory,
  // Rabbi taxonomy (rabi-add)
  getWPRabbis,
  createWPRabbi,
};

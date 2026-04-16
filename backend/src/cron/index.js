'use strict';

/**
 * Cron Job Scheduler
 * ─────────────────────────────────────────────────────────────────────────────
 * מתזמן משימות רקע עבור מערכת "ענה את השואל".
 * כל משימה מוגדרת כפונקציה נפרדת בתיקיית ./jobs/
 *
 * All schedules use Asia/Jerusalem timezone.
 *
 * Usage:
 *   const { startCronJobs } = require('./cron');
 *   startCronJobs();   // called once in server.js after DB + Redis are ready
 * ─────────────────────────────────────────────────────────────────────────────
 */

const cron = require('node-cron');

// ── Job imports ──────────────────────────────────────────────────────────────
const { runTimeoutCheck }       = require('./jobs/timeoutCheck');
const { runWarningCheck }       = require('./jobs/warningCheck');
const { runDailyDigest }        = require('./jobs/dailyDigest');
const { runWeeklyReport: runWeeklyStatsReport } = require('./jobs/weeklyReport');
const { runRabbiOfTheWeek }     = require('./jobs/rabbiOfTheWeek');
const { runWpSyncRetry }        = require('./jobs/wpSyncRetry');
const { runSheetsSyncLeads }    = require('./jobs/sheetsSyncLeads');
const { runWeeklyNewsletter }   = require('./jobs/weeklyNewsletter');
const { runHolidayGreetings }   = require('./jobs/holidayGreetings');
const { runImapPoller }         = require('./jobs/imapPoller');
const { runOnboardingDrip }    = require('./jobs/onboardingDrip');
const { runPendingReminder }   = require('./jobs/pendingReminder');
const { runSyncNedarimHistory } = require('./jobs/syncNedarimHistory');
const {
  syncPendingQuestions,
  syncAnswersToWP,
}                               = require('../services/questionSyncService');
const { getWPCategories }       = require('../services/wpService');
const { query: dbQuery }        = require('../db/pool');

const TIMEZONE = 'Asia/Jerusalem';

// ── Safe wrapper ─────────────────────────────────────────────────────────────

/**
 * Wraps a cron job handler so unhandled errors are logged but never crash
 * the main process.
 *
 * @param {string}   name  Human-readable job name (for logs)
 * @param {Function} fn    Async job function
 * @returns {Function}
 */
function safeJob(name, fn) {
  return async () => {
    const start = Date.now();
    try {
      console.log(`[cron] START ${name}`);
      await fn();
      console.log(`[cron] DONE  ${name} (${Date.now() - start}ms)`);
    } catch (err) {
      console.error(`[cron] FAIL  ${name}:`, err.message, err.stack);
    }
  };
}

// ── Schedule jobs ────────────────────────────────────────────────────────────

/**
 * Register and start all cron jobs.
 * Called once from server.js after DB and Redis connections are established.
 *
 * @param {import('socket.io').Server|null} [io]
 *   Socket.io server instance — forwarded to syncPendingQuestions so that
 *   new questions discovered via polling trigger real-time broadcasts.
 */
function startCronJobs(io = null) {
  console.log('[cron] Registering cron jobs (timezone: %s)...', TIMEZONE);

  // ─── Every 30 min — release stale in_process questions back to pending ────
  cron.schedule('*/30 * * * *', safeJob('checkQuestionTimeouts', runTimeoutCheck), {
    timezone: TIMEZONE,
  });

  // ─── Every 30 min — warn rabbi 1 hour before question timeout ─────────────
  cron.schedule('*/30 * * * *', safeJob('sendTimeoutWarnings', runWarningCheck), {
    timezone: TIMEZONE,
  });

  // ─── Daily 08:00 Israel — send pending questions digest to rabbis ─────────
  cron.schedule('0 8 * * *', safeJob('sendPendingQuestionsDigest', runDailyDigest), {
    timezone: TIMEZONE,
  });

  // ─── Weekly — send rabbi stats report (configurable, default Fri 08:00) ───
  const statsReportCron = process.env.CRON_STATS_REPORT || '0 8 * * 5';
  cron.schedule(statsReportCron, safeJob('sendRabbiStatsReport', runWeeklyStatsReport), {
    timezone: TIMEZONE,
  });

  // ─── Weekly — post "Rabbi of the Week" to WordPress (default Sun 09:00) ───
  const rabbiOfWeekCron = process.env.CRON_RABBI_OF_WEEK || '0 9 * * 0';
  cron.schedule(rabbiOfWeekCron, safeJob('postRabbiOfTheWeek', runRabbiOfTheWeek), {
    timezone: TIMEZONE,
  });

  // ─── Every 2 min — sync pending answers to WordPress ─────────────────────
  cron.schedule('*/2 * * * *', safeJob('syncAnswersToWP', syncAnswersToWP), {
    timezone: TIMEZONE,
  });

  // ─── Every 1 hour — retry failed WordPress syncs ──────────────────────────
  cron.schedule('0 * * * *', safeJob('retryFailedWordPressSyncs', runWpSyncRetry), {
    timezone: TIMEZONE,
  });

  // ─── Every 5 min — pull new questions from WordPress ────────────────────────
  if (process.env.DISABLE_WP_SYNC !== 'true') {
    cron.schedule('*/5 * * * *', safeJob('syncPendingQuestionsFromWP', () => syncPendingQuestions(io)), {
      timezone: TIMEZONE,
    });
  } else {
    console.log('[cron] syncPendingQuestionsFromWP DISABLED (DISABLE_WP_SYNC=true)');
  }

  // ─── Every 15 min — sync leads to Google Sheets ───────────────────────────
  cron.schedule('*/15 * * * *', safeJob('syncLeadsToGoogleSheets', runSheetsSyncLeads), {
    timezone: TIMEZONE,
  });

  // ─── Weekly Friday 10:00 — send שו"ת השבוע newsletter ─────────────────────
  cron.schedule('0 10 * * 5', safeJob('sendWeeklyNewsletter', runWeeklyNewsletter), {
    timezone: TIMEZONE,
  });

  // ─── Every 10 min — send onboarding drip emails ──────────────────────────
  cron.schedule('*/10 * * * *', safeJob('onboardingDrip', runOnboardingDrip), {
    timezone: TIMEZONE,
  });

  // ─── Every 2 min — poll IMAP mailbox for rabbi email replies ──────────────
  cron.schedule('*/2 * * * *', safeJob('imapPoller', runImapPoller), {
    timezone: TIMEZONE,
  });

  // ─── Daily 08:00 — check for Jewish holiday and send greetings ────────────
  cron.schedule('0 8 * * *', safeJob('sendHolidayGreetings', runHolidayGreetings), {
    timezone: TIMEZONE,
  });

  // ─── Every hour — remind rabbis about overdue pending questions ───────────
  // Controlled by admin via system_config.pending_reminder (enabled/hours/remind_every).
  // Job itself is a no-op when disabled, so safe to schedule unconditionally.
  cron.schedule('15 * * * *', safeJob('pendingQuestionsReminder', runPendingReminder), {
    timezone: TIMEZONE,
  });

  // ─── Every hour — pull Nedarim Plus transaction history as safety net ─────
  // Backup for missed webhooks (Nedarim does not retry on failure). Idempotent
  // on TransactionId so duplicates from webhook+sync are harmless.
  cron.schedule('30 * * * *', safeJob('syncNedarimHistory', runSyncNedarimHistory), {
    timezone: TIMEZONE,
  });

  // ─── Startup: auto-sync categories from WP if local DB has fewer ─────────
  if (process.env.DISABLE_WP_SYNC !== 'true') {
    setImmediate(async () => {
      try {
        const { rows: localCount } = await dbQuery(
          `SELECT COUNT(*) AS cnt FROM categories WHERE status != 'rejected'`
        );
        const localCnt = parseInt(localCount[0].cnt, 10);

        const wpResult = await getWPCategories();
        if (!wpResult.success || !wpResult.data) {
          console.log('[cron/startup] Could not fetch WP categories for auto-sync');
          return;
        }

        const wpCnt = wpResult.data.length;
        console.log(`[cron/startup] Categories: local=${localCnt}, WP=${wpCnt}`);

        if (localCnt < wpCnt) {
          console.log('[cron/startup] Local DB has fewer categories — running auto-sync from WP...');

          const { rows: localCats } = await dbQuery(
            `SELECT id, name, wp_term_id FROM categories WHERE status != 'rejected'`
          );
          const existingWpIds = new Set(localCats.filter(c => c.wp_term_id).map(c => c.wp_term_id));
          const existingNames = new Set(localCats.map(c => c.name.trim().toLowerCase()));

          let created = 0;
          for (const wpTerm of wpResult.data) {
            if (existingWpIds.has(wpTerm.id)) continue;

            if (existingNames.has(wpTerm.name.trim().toLowerCase())) {
              const localMatch = localCats.find(
                c => c.name.trim().toLowerCase() === wpTerm.name.trim().toLowerCase() && !c.wp_term_id
              );
              if (localMatch) {
                await dbQuery(
                  `UPDATE categories SET wp_term_id = $1 WHERE id = $2`,
                  [wpTerm.id, localMatch.id]
                );
              }
              continue;
            }

            try {
              await dbQuery(
                `INSERT INTO categories (name, parent_id, sort_order, status, wp_term_id, created_at)
                 VALUES ($1, NULL, 0, 'approved', $2, NOW())`,
                [wpTerm.name.trim(), wpTerm.id]
              );
              created++;
            } catch (_) { /* duplicate or other — skip */ }
          }

          if (created > 0) {
            console.log(`[cron/startup] Auto-synced ${created} new categories from WP`);
          }
        } else {
          console.log('[cron/startup] Categories are in sync (local >= WP count)');
        }
      } catch (err) {
        console.error('[cron/startup] Category auto-sync error:', err.message);
      }
    });
  }

  console.log('[cron] All jobs registered:');
  console.log('[cron]   checkQuestionTimeouts:      */30 * * * *');
  console.log('[cron]   sendTimeoutWarnings:        */30 * * * *');
  console.log('[cron]   sendPendingQuestionsDigest: 0 8 * * *');
  console.log('[cron]   sendRabbiStatsReport:       %s', statsReportCron);
  console.log('[cron]   postRabbiOfTheWeek:         %s', rabbiOfWeekCron);
  console.log('[cron]   retryFailedWordPressSyncs:  0 * * * *');
  console.log('[cron]   syncLeadsToGoogleSheets:    */15 * * * *');
  console.log('[cron]   sendWeeklyNewsletter:       0 10 * * 5');
  console.log('[cron]   sendHolidayGreetings:       0 8 * * *');
  console.log('[cron]   pendingQuestionsReminder:   15 * * * *');
  console.log('[cron]   syncNedarimHistory:         30 * * * *');
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { startCronJobs };

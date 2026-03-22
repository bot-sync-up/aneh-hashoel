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
const { syncPendingQuestions }  = require('../services/questionSyncService');

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
 */
function startCronJobs() {
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

  // ─── Every 1 hour — retry failed WordPress syncs ──────────────────────────
  cron.schedule('0 * * * *', safeJob('retryFailedWordPressSyncs', runWpSyncRetry), {
    timezone: TIMEZONE,
  });

  // ─── Every 5 min — pull new questions from WordPress ────────────────────────
  if (process.env.DISABLE_WP_SYNC !== 'true') {
    cron.schedule('*/5 * * * *', safeJob('syncPendingQuestionsFromWP', syncPendingQuestions), {
      timezone: TIMEZONE,
    });
  } else {
    console.log('[cron] syncPendingQuestionsFromWP DISABLED (DISABLE_WP_SYNC=true)');
  }

  // ─── Every 15 min — sync leads to Google Sheets ───────────────────────────
  cron.schedule('*/15 * * * *', safeJob('syncLeadsToGoogleSheets', runSheetsSyncLeads), {
    timezone: TIMEZONE,
  });

  console.log('[cron] All jobs registered:');
  console.log('[cron]   checkQuestionTimeouts:      */30 * * * *');
  console.log('[cron]   sendTimeoutWarnings:        */30 * * * *');
  console.log('[cron]   sendPendingQuestionsDigest: 0 8 * * *');
  console.log('[cron]   sendRabbiStatsReport:       %s', statsReportCron);
  console.log('[cron]   postRabbiOfTheWeek:         %s', rabbiOfWeekCron);
  console.log('[cron]   retryFailedWordPressSyncs:  0 * * * *');
  console.log('[cron]   syncLeadsToGoogleSheets:    */15 * * * *');
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { startCronJobs };

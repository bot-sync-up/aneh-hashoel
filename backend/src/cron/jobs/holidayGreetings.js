'use strict';

/**
 * holidayGreetings.js
 * ─────────────────────────────────────────────────────────────────────────────
 * שולח ברכות חג ב-WhatsApp לכל הלידים עם מספר טלפון מהשנה האחרונה.
 * רץ כל יום בשעה 08:00 ובודק אם היום חג יהודי.
 *
 * Feature-flagged: רץ רק אם GREENAPI_INSTANCE_ID מוגדר.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');
const { sendHolidayMessage } = require('../../services/whatsappService');
const { decryptField } = require('../../utils/encryption');

// ── Jewish holidays with approximate Gregorian dates for 2026 ──────────────

const HOLIDAYS = [
  {
    name: 'פסח',
    month: 4,  // April
    day: 1,
    donationCampaign: 'קמחא דפסחא',
    donationLink: 'https://morashet-maran.org.il/donate/pesach',
  },
  {
    name: 'ראש השנה',
    month: 9,  // September
    day: 12,
    donationCampaign: 'שנה טובה',
    donationLink: 'https://morashet-maran.org.il/donate/rosh-hashana',
  },
  {
    name: 'סוכות',
    month: 9,  // September
    day: 26,
    donationCampaign: 'ארבעת המינים',
    donationLink: 'https://morashet-maran.org.il/donate/sukkot',
  },
  {
    name: 'חנוכה',
    month: 12, // December
    day: 5,
    donationCampaign: 'נר חנוכה',
    donationLink: 'https://morashet-maran.org.il/donate/chanukah',
  },
];

/**
 * Checks if today (in Israel timezone) matches any holiday.
 * @returns {object|null} The matching holiday object, or null.
 */
function _getTodaysHoliday() {
  // Get current date in Israel timezone
  const now = new Date();
  const israelDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const month = israelDate.getMonth() + 1; // 1-indexed
  const day = israelDate.getDate();

  return HOLIDAYS.find((h) => h.month === month && h.day === day) || null;
}

/**
 * Fetches all leads with phone numbers from the past year.
 * @returns {Promise<Array<{ phone: string }>>}
 */
async function _getLeadsWithPhones() {
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  // שליחת ברכות חג היא מסר שיווקי — מסננים לידים שהסירו עצמם מרשימת התפוצה
  // (is_unsubscribed = TRUE), כמתחייב מתיקון 40 לחוק התקשורת.
  const { rows } = await query(
    `SELECT asker_phone_encrypted
     FROM   leads
     WHERE  asker_phone_encrypted IS NOT NULL
       AND  last_question_at >= $1
       AND  is_unsubscribed = FALSE`,
    [yearAgo.toISOString()]
  );

  // Decrypt phone numbers
  const leads = [];
  for (const row of rows) {
    const phone = decryptField(row.asker_phone_encrypted);
    if (phone) {
      leads.push({ phone });
    }
  }

  return leads;
}

/**
 * Sleep helper.
 * @param {number} ms
 */
function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main cron handler — runs daily at 08:00.
 */
async function runHolidayGreetings() {
  // Feature flag: only run if WhatsApp is configured
  if (!process.env.GREENAPI_INSTANCE_ID) {
    console.info('[holiday-greetings] GREENAPI_INSTANCE_ID not set — skipping');
    return;
  }

  const holiday = _getTodaysHoliday();
  if (!holiday) {
    console.info('[holiday-greetings] היום אינו חג — דילוג');
    return;
  }

  console.info(`[holiday-greetings] חג ${holiday.name}! מתחיל שליחת ברכות...`);

  const leads = await _getLeadsWithPhones();
  if (leads.length === 0) {
    console.info('[holiday-greetings] אין לידים עם מספר טלפון — דילוג');
    return;
  }

  console.info(`[holiday-greetings] שולח ברכות ל-${leads.length} לידים...`);

  let successCount = 0;
  let failCount = 0;

  for (const lead of leads) {
    if (successCount + failCount > 0) {
      await _sleep(500); // Rate limiting
    }

    const result = await sendHolidayMessage(
      lead.phone,
      holiday.name,
      holiday.donationLink
    );

    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.info(
    `[holiday-greetings] סיום שליחת ברכות חג ${holiday.name}: ` +
    `${successCount} הצלחות, ${failCount} כשלונות`
  );
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runHolidayGreetings };

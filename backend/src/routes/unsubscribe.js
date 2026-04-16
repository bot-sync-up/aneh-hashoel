'use strict';

/**
 * Unsubscribe routes (public, token-based).
 *
 * Endpoints:
 *   GET  /unsubscribe?token=<jwt>     → show status + buttons
 *   POST /unsubscribe/confirm         → flip is_unsubscribed=true for lead_id in token
 *   POST /unsubscribe/resubscribe     → flip back to false
 *
 * The token is a short signed JWT containing the lead id. Emails embed the
 * URL so a single click proves the recipient owns the inbox.
 */

const express = require('express');
const jwt     = require('jsonwebtoken');
const { query } = require('../db/pool');
const { logger } = require('../utils/logger');

const log = logger.child({ module: 'unsubscribe' });
const router = express.Router();

const UNSUB_SECRET = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'aneh-unsub-dev-secret';
const UNSUB_TTL    = '365d';

/** Sign an unsubscribe token for a lead. Used by the email template helper. */
function signUnsubscribeToken(leadId) {
  return jwt.sign({ lid: String(leadId) }, UNSUB_SECRET, { expiresIn: UNSUB_TTL });
}

/** Verify + decode a token. Returns lead id or null. */
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, UNSUB_SECRET);
    return payload?.lid || null;
  } catch {
    return null;
  }
}

// ─── GET /unsubscribe ────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const token = String(req.query.token || '');
  const leadId = verifyToken(token);
  if (!leadId) {
    return res.status(400).send(_errorPage('הקישור לא תקין או פג תוקפו'));
  }

  try {
    const { rows } = await query(
      'SELECT id, asker_name, is_unsubscribed FROM leads WHERE id = $1',
      [leadId]
    );
    if (rows.length === 0) {
      return res.status(404).send(_errorPage('לא נמצא רישום תואם'));
    }
    const lead = rows[0];
    return res.send(_statusPage(token, lead));
  } catch (err) {
    log.error({ err, leadId }, 'unsubscribe: DB error');
    return res.status(500).send(_errorPage('שגיאה טכנית, נסה שוב מאוחר יותר'));
  }
});

// ─── POST /unsubscribe/confirm ───────────────────────────────────────────────

router.post('/confirm', async (req, res) => {
  const token = String(req.body?.token || req.query.token || '');
  const leadId = verifyToken(token);
  if (!leadId) return res.status(400).json({ error: 'הקישור לא תקין' });

  try {
    await query(
      `UPDATE leads SET is_unsubscribed = TRUE, unsubscribed_at = NOW() WHERE id = $1`,
      [leadId]
    );
    log.info({ leadId }, 'unsubscribe: confirmed');
    return res.json({ ok: true, unsubscribed: true });
  } catch (err) {
    log.error({ err, leadId }, 'unsubscribe: DB error');
    return res.status(500).json({ error: 'שגיאה טכנית' });
  }
});

// ─── POST /unsubscribe/resubscribe ───────────────────────────────────────────

router.post('/resubscribe', async (req, res) => {
  const token = String(req.body?.token || req.query.token || '');
  const leadId = verifyToken(token);
  if (!leadId) return res.status(400).json({ error: 'הקישור לא תקין' });

  try {
    await query(
      `UPDATE leads SET is_unsubscribed = FALSE, unsubscribed_at = NULL WHERE id = $1`,
      [leadId]
    );
    log.info({ leadId }, 'unsubscribe: resubscribed');
    return res.json({ ok: true, unsubscribed: false });
  } catch (err) {
    log.error({ err, leadId }, 'unsubscribe: DB error');
    return res.status(500).json({ error: 'שגיאה טכנית' });
  }
});

// ─── Page templates ──────────────────────────────────────────────────────────

function _statusPage(token, lead) {
  const name = lead.asker_name || 'שואל יקר';
  const unsubbed = !!lead.is_unsubscribed;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ניהול התפוצה — שאל את הרב</title>
  <style>
    body { margin:0; padding:0; background:#f4f4f7; font-family:'Heebo',Arial,sans-serif; direction:rtl; }
    .wrap { max-width:560px; margin:40px auto; padding:0 16px; }
    .card { background:#fff; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.08); overflow:hidden; }
    .head { background:#1B2B5E; color:#fff; padding:24px 32px; text-align:center; }
    .head h1 { margin:0; font-size:22px; color:#B8973A; }
    .body { padding:32px; text-align:center; font-size:15px; color:#333; line-height:1.7; }
    .body p { margin:0 0 16px; }
    .btn { display:inline-block; padding:12px 28px; border-radius:8px; font-size:15px; font-weight:700;
           cursor:pointer; border:none; margin:8px 4px; font-family:inherit; text-decoration:none; }
    .btn-primary { background:#1B2B5E; color:#fff; }
    .btn-danger  { background:#cc4444; color:#fff; }
    .btn-outline { background:#fff; color:#1B2B5E; border:2px solid #1B2B5E; }
    .status { padding:12px 16px; border-radius:8px; margin:16px 0; font-weight:600; }
    .status-active { background:#f0fdf4; color:#166534; border:1px solid #86efac; }
    .status-removed { background:#fef3c7; color:#92400e; border:1px solid #fcd34d; }
    #result { margin-top:20px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head"><h1>ניהול התפוצה</h1></div>
      <div class="body">
        <p>שלום ${_escape(name)},</p>
        ${unsubbed
          ? `<div class="status status-removed">הוסרת מרשימת התפוצה של "שאל את הרב"</div>
             <p>לא תקבל/י יותר מיילי עדכונים, ניוזלטר או תזכורות.</p>
             <p><small>* תמיד תקבל/י מייל תשובה לשאלה ששלחת — זו פנייה מפורשת שלך.</small></p>
             <button class="btn btn-primary" onclick="resub()">חזור לרשימת התפוצה</button>`
          : `<div class="status status-active">את/ה רשום/ה לרשימת התפוצה של "שאל את הרב"</div>
             <p>האם להסיר אותך מהרשימה? לא תקבל/י יותר מיילי עדכונים או ניוזלטר.</p>
             <button class="btn btn-danger" onclick="unsub()">הסר אותי</button>
             <button class="btn btn-outline" onclick="window.close()">ביטול</button>`
        }
        <div id="result"></div>
      </div>
    </div>
  </div>
  <script>
    const token = ${JSON.stringify(token)};
    async function unsub() {
      const r = await fetch('/unsubscribe/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({token}) });
      if (r.ok) { document.getElementById('result').innerHTML = '<div class="status status-removed">✅ הוסרת בהצלחה. תודה.</div>'; setTimeout(()=>location.reload(),1500); }
      else document.getElementById('result').innerHTML = '<div class="status status-removed">שגיאה. נסה שוב.</div>';
    }
    async function resub() {
      const r = await fetch('/unsubscribe/resubscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({token}) });
      if (r.ok) { document.getElementById('result').innerHTML = '<div class="status status-active">✅ חזרת לרשימת התפוצה.</div>'; setTimeout(()=>location.reload(),1500); }
      else document.getElementById('result').innerHTML = '<div class="status status-removed">שגיאה. נסה שוב.</div>';
    }
  </script>
</body>
</html>`;
}

function _errorPage(msg) {
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>שגיאה</title>
<style>body{font-family:'Heebo',Arial,sans-serif;background:#f4f4f7;padding:40px;text-align:center;direction:rtl;}
.card{max-width:480px;margin:40px auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);}
h1{color:#cc4444;margin:0 0 12px;}p{color:#666;}</style></head>
<body><div class="card"><h1>שגיאה</h1><p>${_escape(msg)}</p></div></body></html>`;
}

function _escape(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

module.exports = router;
module.exports.signUnsubscribeToken = signUnsubscribeToken;

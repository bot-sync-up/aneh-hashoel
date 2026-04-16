'use strict';

/**
 * Nedarim Plus Donations Webhook  —  POST /webhook/nedarim
 * ─────────────────────────────────────────────────────────────────────────────
 * Nedarim Plus sends a POST with application/json after every completed
 * credit-card transaction (and standing-order setup).
 *
 * IMPORTANT: Nedarim does NOT retry on failure — so in addition to this
 * webhook we also pull transactions hourly via cron/jobs/syncNedarimHistory.js
 * as a safety net. Both paths use upsertDonation() which is idempotent on
 * the Nedarim TransactionId.
 *
 * Fields from Nedarim (see docs/CallBack.pdf for full reference):
 *   TransactionId, ClientId, Zeout, ClientName, Adresse, Phone, Mail,
 *   Amount, Currency (1=ILS, 2=USD), TransactionTime, Confirmation,
 *   LastNum, Tokef, TransactionType, Groupe, Comments, Tashloumim,
 *   FirstTashloum, MosadNumber, CallId, MasofId, Shovar, CompagnyCard,
 *   Solek, Tayar, Makor, KevaId, DebitIframe
 *
 * Standing-order setup adds: KevaId, NextDate.
 *
 * Auth:
 *   Shared secret via NEDARIM_WEBHOOK_SECRET env var. If unset, the
 *   endpoint is open (dev convenience). Set it in prod.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const { logger } = require('../utils/logger');
const { mapNedarimPayload, upsertDonation } = require('../services/nedarimService');

const log = logger.child({ module: 'donations-webhook' });
const router = express.Router();

// ─── Shared-secret validation ────────────────────────────────────────────────

function validateSecret(req, res, next) {
  const secret = process.env.NEDARIM_WEBHOOK_SECRET;
  // Dev convenience: if secret not configured, accept all.
  if (!secret) return next();

  const provided =
    req.headers['x-nedarim-secret'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
    req.body?.secret ||
    req.query?.secret;

  if (provided !== secret) {
    log.warn({ ip: req.ip }, 'Invalid secret on nedarim webhook');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── POST /webhook/nedarim ───────────────────────────────────────────────────

router.post('/', validateSecret, async (req, res) => {
  const payload = req.body || {};

  // Map → unified shape (handles both PascalCase from Nedarim and legacy)
  const mapped = mapNedarimPayload(payload);
  if (!mapped) {
    log.warn({ keys: Object.keys(payload).slice(0, 10) }, 'Nedarim payload rejected');
    return res.status(400).json({
      error: 'Invalid payload — Amount is required and must be positive',
    });
  }

  try {
    const inserted = await upsertDonation(mapped, 'webhook');

    if (!inserted) {
      // TransactionId already exists — our history sync already stored it,
      // or Nedarim re-sent on manual trigger. Ack OK; don't surface error.
      log.info(
        { transactionId: mapped.transaction_id },
        'Duplicate Nedarim transaction — already stored'
      );
      return res.json({ ok: true, duplicate: true });
    }

    log.info(
      {
        id: inserted.id,
        amount: inserted.amount,
        currency: inserted.currency,
        transactionId: inserted.transaction_id,
        questionId: mapped.question_id,
        rabbiId: mapped.rabbi_id,
      },
      'Nedarim donation recorded'
    );

    return res.json({ ok: true, id: inserted.id });
  } catch (err) {
    log.error({ err }, 'Nedarim webhook handler error');
    // Per docs: Nedarim won't retry — but return 500 anyway so their
    // alert email gets triggered and the admin notices.
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

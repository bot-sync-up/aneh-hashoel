'use strict';

/**
 * Nedarim Plus Donations Webhook  —  POST /webhook/nedarim
 *
 * Receives donation callbacks from Nedarim Plus after a payment is completed.
 * Nedarim Plus handles all payment processing externally; this endpoint
 * only records the donation in our database for tracking/reporting.
 *
 * Authentication: shared secret via NEDARIM_WEBHOOK_SECRET env var.
 * If the env var is not set, the endpoint is open (development convenience).
 *
 * The reference field from Nedarim may encode question/rabbi IDs in the format:
 *   "q:<questionId>"  or  "r:<rabbiId>"  or  "q:<questionId>:r:<rabbiId>"
 * This allows linking a donation to a specific question or rabbi.
 */

const express = require('express');
const { query: dbQuery } = require('../db/pool');

const router = express.Router();

// ─── Webhook secret validation ───────────────────────────────────────────────

function validateSecret(req, res, next) {
  const secret = process.env.NEDARIM_WEBHOOK_SECRET;
  // If no secret configured, skip validation (dev mode)
  if (!secret) return next();

  const provided =
    req.headers['x-nedarim-secret'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.body?.secret;

  if (provided !== secret) {
    console.warn('[donations-webhook] Invalid secret from', req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Parse reference for question/rabbi IDs ──────────────────────────────────

function parseReference(reference) {
  const result = { questionId: null, rabbiId: null };
  if (!reference) return result;

  // Format: "q:<uuid>" and/or "r:<uuid>" separated by ":"
  const qMatch = reference.match(/q:([0-9a-f-]{36})/i);
  const rMatch = reference.match(/r:([0-9a-f-]{36})/i);

  if (qMatch) result.questionId = qMatch[1];
  if (rMatch) result.rabbiId = rMatch[1];

  return result;
}

// ─── POST /webhook/nedarim ───────────────────────────────────────────────────

router.post('/', validateSecret, async (req, res) => {
  try {
    const {
      amount,
      currency,
      donor_name,
      donor_email,
      donor_phone,
      reference,
      payment_method,
      notes,
    } = req.body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'amount is required and must be positive' });
    }

    const { questionId, rabbiId } = parseReference(reference);

    const result = await dbQuery(
      `INSERT INTO donations
         (question_id, rabbi_id, amount, currency, donor_name, donor_email,
          donor_phone, nedarim_reference, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (nedarim_reference) WHERE nedarim_reference IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        questionId,
        rabbiId,
        Number(amount),
        (currency || 'ILS').toUpperCase().slice(0, 3),
        donor_name || null,
        donor_email || null,
        donor_phone || null,
        reference || null,
        payment_method || null,
        notes || null,
      ]
    );

    if (result.rows.length === 0) {
      // Duplicate reference — already recorded
      console.log('[donations-webhook] Duplicate reference ignored:', reference);
      return res.json({ ok: true, duplicate: true });
    }

    console.log(
      '[donations-webhook] Donation recorded:',
      result.rows[0].id,
      `${amount} ${currency || 'ILS'}`
    );

    return res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[donations-webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

'use strict';

/**
 * MailWizz Integration Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Connects to MailWizz email marketing API for subscriber management
 * and campaign triggering.
 *
 * Feature-flagged: if MAILWIZZ_API_URL is not set, all operations are
 * skipped silently (no-op).  This allows the infrastructure to be deployed
 * and activated later by adding MailWizz credentials to the environment.
 *
 * Required env vars (when active):
 *   MAILWIZZ_API_URL   – MailWizz API base URL (e.g. https://mail.example.com/api)
 *   MAILWIZZ_API_KEY   – MailWizz API public key
 *   MAILWIZZ_LIST_ID   – Default subscriber list UID
 */

const axios = require('axios');

// ── Config helpers ──────────────────────────────────────────────────────────

/**
 * Returns MailWizz credentials if configured, null otherwise.
 * @returns {{ apiUrl: string, apiKey: string, listId: string }|null}
 */
function _getConfig() {
  const apiUrl = process.env.MAILWIZZ_API_URL;
  const apiKey = process.env.MAILWIZZ_API_KEY;
  const listId = process.env.MAILWIZZ_LIST_ID;

  if (!apiUrl) {
    // Not configured — silently disabled
    return null;
  }

  if (!apiKey || !listId) {
    console.warn('[mailwizzService] MAILWIZZ_API_URL is set but MAILWIZZ_API_KEY or MAILWIZZ_LIST_ID is missing — disabled');
    return null;
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    apiKey,
    listId,
  };
}

/**
 * Create an axios instance configured for MailWizz API.
 * @param {object} config
 * @returns {import('axios').AxiosInstance}
 */
function _createClient(config) {
  return axios.create({
    baseURL: config.apiUrl,
    timeout: 15000,
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
    },
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Add or update a subscriber in the MailWizz list.
 *
 * If the subscriber already exists (by email), their fields are updated.
 * Custom fields are passed as key-value pairs in the `fields` parameter.
 *
 * @param {string} email      – Subscriber email address
 * @param {string} [name]     – Subscriber display name
 * @param {object} [fields]   – Custom fields (e.g. { category_interest, question_count })
 * @returns {Promise<{ success: boolean, subscriberId?: string, error?: string }>}
 */
async function addSubscriber(email, name, fields = {}) {
  const config = _getConfig();
  if (!config) {
    // MailWizz not configured — skip silently
    return { success: false, error: 'MailWizz not configured' };
  }

  if (!email) {
    return { success: false, error: 'Email is required' };
  }

  const client = _createClient(config);

  const payload = {
    EMAIL: email,
    ...(name ? { FNAME: name } : {}),
  };

  // Merge custom fields
  if (fields && typeof fields === 'object') {
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        payload[key.toUpperCase()] = String(value);
      }
    });
  }

  try {
    const response = await client.post(
      `/lists/${config.listId}/subscribers`,
      payload
    );

    const subscriberId = response.data?.data?.record?.subscriber_uid || null;
    console.info(`[mailwizzService] addSubscriber: ${email} — subscriberId: ${subscriberId}`);
    return { success: true, subscriberId };
  } catch (err) {
    // If subscriber already exists, try to update
    if (err.response?.status === 409 || err.response?.data?.status === 'error') {
      try {
        // Search for existing subscriber
        const searchRes = await client.get(
          `/lists/${config.listId}/subscribers/search-by-email`,
          { params: { EMAIL: email } }
        );

        const existingUid = searchRes.data?.data?.subscriber_uid;
        if (existingUid) {
          await client.put(
            `/lists/${config.listId}/subscribers/${existingUid}`,
            payload
          );
          console.info(`[mailwizzService] addSubscriber: updated existing ${email} — uid: ${existingUid}`);
          return { success: true, subscriberId: existingUid };
        }
      } catch (updateErr) {
        const errMsg = `MailWizz update failed: ${updateErr.response?.data?.error || updateErr.message}`;
        console.error(`[mailwizzService] addSubscriber update error:`, errMsg);
        return { success: false, error: errMsg };
      }
    }

    const errMsg = `MailWizz error: ${err.response?.data?.error || err.message}`;
    console.error(`[mailwizzService] addSubscriber error:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Tag a subscriber for the onboarding email sequence.
 *
 * Adds the subscriber with an ONBOARDING=yes custom field that can be
 * used as a segment trigger in MailWizz autoresponders.
 *
 * @param {string} email – Subscriber email address
 * @param {string} [name] – Subscriber display name
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function triggerOnboarding(email, name) {
  const config = _getConfig();
  if (!config) {
    return { success: false, error: 'MailWizz not configured' };
  }

  if (!email) {
    return { success: false, error: 'Email is required' };
  }

  const result = await addSubscriber(email, name, {
    onboarding: 'yes',
    onboarding_date: new Date().toISOString().slice(0, 10),
  });

  if (result.success) {
    console.info(`[mailwizzService] triggerOnboarding: ${email} tagged for onboarding`);
  }

  return result;
}

/**
 * Update a subscriber's category interest field.
 *
 * This tracks which halachic categories the asker is interested in,
 * enabling targeted newsletter content.
 *
 * @param {string} email        – Subscriber email address
 * @param {string} categoryName – Category name to record as interest
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function updateInterest(email, categoryName) {
  const config = _getConfig();
  if (!config) {
    return { success: false, error: 'MailWizz not configured' };
  }

  if (!email || !categoryName) {
    return { success: false, error: 'Email and category name are required' };
  }

  const result = await addSubscriber(email, null, {
    category_interest: categoryName,
    last_interest_date: new Date().toISOString().slice(0, 10),
  });

  if (result.success) {
    console.info(`[mailwizzService] updateInterest: ${email} → ${categoryName}`);
  }

  return result;
}

/**
 * Trigger a newsletter campaign via the MailWizz API.
 * Used by the weekly newsletter cron job to send the "שו"ת השבוע" campaign.
 *
 * @param {string} subject    – Campaign subject line
 * @param {string} htmlBody   – Campaign HTML content
 * @returns {Promise<{ success: boolean, campaignId?: string, error?: string }>}
 */
async function triggerCampaign(subject, htmlBody) {
  const config = _getConfig();
  if (!config) {
    console.info('[mailwizzService] triggerCampaign: MailWizz not configured — logging only');
    console.info(`[mailwizzService] Campaign subject: ${subject}`);
    return { success: false, error: 'MailWizz not configured' };
  }

  const client = _createClient(config);

  try {
    const response = await client.post('/campaigns', {
      name: subject,
      type: 'regular',
      from_name: process.env.SENDGRID_FROM_NAME || 'ענה את השואל',
      from_email: process.env.SENDGRID_FROM_EMAIL || 'noreply@aneh-hashoel.co.il',
      subject,
      list_uid: config.listId,
      template: {
        inline_html: htmlBody,
      },
      send_at: new Date().toISOString(),
    });

    const campaignId = response.data?.data?.record?.campaign_uid || null;
    console.info(`[mailwizzService] triggerCampaign: created — campaignId: ${campaignId}`);
    return { success: true, campaignId };
  } catch (err) {
    const errMsg = `MailWizz campaign error: ${err.response?.data?.error || err.message}`;
    console.error(`[mailwizzService] triggerCampaign error:`, errMsg);
    return { success: false, error: errMsg };
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  addSubscriber,
  triggerOnboarding,
  updateInterest,
  triggerCampaign,
};

'use strict';

/**
 * WordPress Connection Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads WP credentials from environment variables and exports a pre-configured
 * axios instance that all WordPress API calls should use.
 *
 * Environment variables:
 *   WP_BASE_URL        – WordPress site root, e.g. https://example.com
 *   WP_AUTH_TOKEN      – Base64-encoded "username:app_password" for
 *                        Application Passwords (RFC 7617 Basic auth).
 *                        Generate with: Buffer.from('user:pass').toString('base64')
 *   WP_WEBHOOK_SECRET  – Shared secret that WordPress sends in
 *                        X-WP-Webhook-Secret on outbound webhook calls.
 *   WP_TIMEOUT_MS      – Request timeout in ms (default: 15000)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate that the minimum required env vars are present.
 * Called lazily on first use so tests can set env vars before requiring the module.
 *
 * @throws {Error} if WP_BASE_URL or WP_AUTH_TOKEN are missing
 */
function assertConfig() {
  const missing = ['WP_BASE_URL', 'WP_AUTH_TOKEN'].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[wp-config] משתני סביבה חסרים: ${missing.join(', ')}. ` +
      'לא ניתן ליצור חיבור ל-WordPress.'
    );
  }
}

// ─── Axios instance (lazy singleton) ─────────────────────────────────────────

let _wpAxios = null;

/**
 * Return a cached axios instance configured for the WP REST API.
 * Constructs the instance on first call and reuses it thereafter.
 *
 * @returns {import('axios').AxiosInstance}
 */
function getWpAxios() {
  if (_wpAxios) return _wpAxios;

  assertConfig();

  const baseURL  = process.env.WP_BASE_URL.replace(/\/$/, '');
  const token    = process.env.WP_AUTH_TOKEN;
  const timeoutMs = parseInt(process.env.WP_TIMEOUT_MS || '15000', 10);

  _wpAxios = axios.create({
    baseURL: `${baseURL}/wp-json/wp/v2`,
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${token}`,
      'Accept': 'application/json',
    },
  });

  // ── Request interceptor: log outgoing calls ──────────────────────────────
  _wpAxios.interceptors.request.use((config) => {
    console.debug(
      `[wp-config] → ${config.method.toUpperCase()} ${config.baseURL}${config.url}`
    );
    return config;
  });

  // ── Response interceptor: log latency and surface WP error bodies ────────
  _wpAxios.interceptors.response.use(
    (response) => {
      console.debug(
        `[wp-config] ← ${response.status} ${response.config.url} ` +
        `(${response.headers['x-response-time'] || '?'}ms)`
      );
      return response;
    },
    (error) => {
      const status  = error.response?.status;
      const wpCode  = error.response?.data?.code    || 'N/A';
      const wpMsg   = error.response?.data?.message || error.message;
      console.error(
        `[wp-config] ✗ ${status || 'NET_ERR'} ${error.config?.url || ''} ` +
        `code=${wpCode} — ${wpMsg}`
      );
      // Attach structured details so callers can inspect without re-parsing
      error.wpStatus  = status;
      error.wpCode    = wpCode;
      error.wpMessage = wpMsg;
      return Promise.reject(error);
    }
  );

  return _wpAxios;
}

/**
 * Reset the cached axios instance.
 * Useful in tests that need to swap env vars between cases.
 */
function resetWpAxios() {
  _wpAxios = null;
}

// ─── Config accessors ─────────────────────────────────────────────────────────

/**
 * The webhook secret WordPress sends in X-WP-Webhook-Secret.
 * Throws if the env var is not set.
 *
 * @returns {string}
 */
function getWebhookSecret() {
  const secret = process.env.WP_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      '[wp-config] WP_WEBHOOK_SECRET לא מוגדר. ' +
      'הגדר את המשתנה בקובץ ה-.env.'
    );
  }
  return secret;
}

/**
 * WordPress site base URL (without trailing slash).
 * @returns {string}
 */
function getBaseUrl() {
  assertConfig();
  return process.env.WP_BASE_URL.replace(/\/$/, '');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getWpAxios,
  resetWpAxios,
  getWebhookSecret,
  getBaseUrl,
};

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Axios instance pre-configured for the ענה את השואל backend.
 *
 * - Base URL from environment or proxy
 * - JSON content-type
 * - 30s timeout
 * - Auth header injection is handled in AuthContext interceptors
 * - 401 token refresh is handled in AuthContext interceptors
 */
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  withCredentials: false,
});

// ── Request interceptor ────────────────────────────────────────────────────
// Injects the access token from localStorage into every request.
// (The AuthContext also adds its own interceptor — this one acts as a
//  fallback for requests that fire before the context is mounted.)
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor ───────────────────────────────────────────────────
// Normalises error shapes and handles network errors gracefully.
// Retries up to MAX_RETRIES times on 500 server errors to prevent infinite loops.
const MAX_RETRIES = 3;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    if (error.code === 'ECONNABORTED') {
      error.message = 'הבקשה ארכה יותר מדי זמן. אנא נסה שוב.';
    } else if (!error.response) {
      error.message = 'לא ניתן להתחבר לשרת. בדוק את החיבור לאינטרנט.';
    }

    // Retry on 500 errors, up to MAX_RETRIES attempts.
    // Skip retries for polling endpoints — those will be re-fetched automatically.
    const requestUrl = config?.url || '';
    const isPollingEndpoint = /dashboard|stats/.test(requestUrl);

    if (
      !isPollingEndpoint &&
      error.response?.status === 500 &&
      config &&
      !config._retryCount
    ) {
      config._retryCount = 0;
    }

    if (
      !isPollingEndpoint &&
      error.response?.status === 500 &&
      config &&
      config._retryCount < MAX_RETRIES
    ) {
      config._retryCount += 1;
      // Brief delay before retry (300ms * attempt number)
      await new Promise((resolve) => setTimeout(resolve, 300 * config._retryCount));
      return api(config);
    }

    return Promise.reject(error);
  }
);

export default api;

// ── Typed request helpers ──────────────────────────────────────────────────

export const get = (url, params, config) =>
  api.get(url, { params, ...config }).then((r) => r.data);

export const post = (url, data, config) =>
  api.post(url, data, config).then((r) => r.data);

export const put = (url, data, config) =>
  api.put(url, data, config).then((r) => r.data);

export const patch = (url, data, config) =>
  api.patch(url, data, config).then((r) => r.data);

export const del = (url, config) =>
  api.delete(url, config).then((r) => r.data);

// ── Multipart / file upload helper ────────────────────────────────────────

export function uploadFile(url, file, fieldName = 'file', extraData = {}, onProgress) {
  const formData = new FormData();
  formData.append(fieldName, file);
  Object.entries(extraData).forEach(([key, val]) => formData.append(key, val));

  return api.post(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress
      ? (evt) => {
          const percent = evt.total
            ? Math.round((evt.loaded / evt.total) * 100)
            : 0;
          onProgress(percent, evt);
        }
      : undefined,
  });
}

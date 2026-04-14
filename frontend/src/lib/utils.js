import { clsx } from 'clsx';
import { format, isValid, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';

// ── HTML entity decoding ───────────────────────────────────────────────────

/**
 * Decode HTML entities like &quot; &amp; &lt; etc. to their text equivalents.
 * Uses the browser's built-in HTML parser for correctness.
 *
 * @param {string} html
 * @returns {string}
 */
let _textarea;
export function decodeHTML(html) {
  if (!html || typeof html !== 'string') return html || '';
  if (!html.includes('&')) return html; // fast path
  if (!_textarea) _textarea = document.createElement('textarea');
  _textarea.innerHTML = html;
  return _textarea.value;
}

// ── cn — classnames merge ──────────────────────────────────────────────────

/**
 * Merge class names using clsx.
 * Mirrors shadcn/ui's `cn` helper.
 */
export function cn(...inputs) {
  return clsx(...inputs);
}

// ── Date formatting ────────────────────────────────────────────────────────

/**
 * Format a date in Hebrew locale.
 *
 * @param {Date|string|number} date
 * @param {string} fmt — date-fns format string (default: 'd בMMMM yyyy')
 * @returns {string} formatted date string
 */
export function formatDate(date, fmt = 'd בMMMM yyyy') {
  if (!date) return '';
  const d = typeof date === 'string' ? parseISO(date) : new Date(date);
  if (!isValid(d)) return '';
  try {
    return format(d, fmt, { locale: he });
  } catch {
    return '';
  }
}

/**
 * Format date and time in Hebrew locale.
 */
export function formatDateTime(date, fmt = "d בMMMM yyyy, HH:mm") {
  return formatDate(date, fmt);
}

/**
 * Relative time in Hebrew with time appended for recent dates.
 *
 * - < 1 min:  "הרגע"
 * - < 1 hour: "לפני X דקות"
 * - < 24 h:   "היום ב-HH:mm"
 * - yesterday: "אתמול ב-HH:mm"
 * - 2 days:   "שלשום ב-HH:mm"
 * - 3-6 days: "לפני X ימים ב-HH:mm"
 * - 7+ days:  "DD/MM/YYYY HH:mm"
 *
 * @param {Date|string|number} date
 */
export function formatRelative(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? parseISO(date) : new Date(date);
  if (!isValid(d)) return '';

  try {
    const now = new Date();
    const diffMs = now - d;
    const diffMinutes = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);

    // Less than 1 minute
    if (diffMinutes < 1) return 'הרגע';

    // Less than 1 hour
    if (diffMinutes < 60) {
      return diffMinutes === 1 ? 'לפני דקה' : `לפני ${diffMinutes} דקות`;
    }

    const time = format(d, 'HH:mm');

    // Less than 24 hours
    if (diffHours < 24) return `היום ב-${time}`;

    // Calculate day difference based on calendar days
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000);

    if (diffDays === 1) return `אתמול ב-${time}`;
    if (diffDays === 2) return `שלשום ב-${time}`;
    if (diffDays >= 3 && diffDays <= 6) return `לפני ${diffDays} ימים ב-${time}`;

    // 7+ days — full date and time
    return format(d, 'dd/MM/yyyy HH:mm');
  } catch {
    return '';
  }
}

/**
 * Short date: "12/03/2025"
 */
export function formatShortDate(date) {
  return formatDate(date, 'dd/MM/yyyy');
}

/**
 * Time only: "14:35"
 */
export function formatTime(date) {
  return formatDate(date, 'HH:mm');
}

// ── String utilities ───────────────────────────────────────────────────────

/**
 * Truncate a string to `maxLength` characters, appending `suffix`.
 *
 * @param {string} str
 * @param {number} maxLength — default 120
 * @param {string} suffix    — default '...'
 */
export function truncate(str, maxLength = 120, suffix = '...') {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  // Try to break at a word boundary
  const cut = str.lastIndexOf(' ', maxLength);
  const end = cut > maxLength * 0.75 ? cut : maxLength;
  return str.slice(0, end) + suffix;
}

/**
 * Strip HTML tags from a string (for plain-text previews of rich-text answers).
 */
export function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/**
 * Highlight a search term in text (returns HTML string — use with dangerouslySetInnerHTML).
 */
export function highlightTerm(text, term) {
  if (!text || !term) return text || '';
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(
    new RegExp(`(${escaped})`, 'gi'),
    '<mark class="bg-amber-200 dark:bg-amber-800 rounded px-0.5">$1</mark>'
  );
}

// ── Status labels ──────────────────────────────────────────────────────────

const STATUS_LABELS = {
  pending: 'ממתינה',
  in_process: 'בטיפול',
  answered: 'נענתה',
  hidden: 'מוסתרת',
  urgent: 'דחוף',
  hot: 'שאלה חמה',
  draft: 'טיוטה',
  archived: 'ארכיון',
};

const STATUS_COLORS = {
  pending: 'text-amber-600 bg-amber-100 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700',
  in_process: 'text-blue-600 bg-blue-100 border-blue-200 dark:text-blue-300 dark:bg-blue-900/30 dark:border-blue-700',
  answered: 'text-emerald-600 bg-emerald-100 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700',
  hidden: 'text-gray-600 bg-gray-100 border-gray-200 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-700',
  urgent: 'text-red-600 bg-red-100 border-red-200 dark:text-red-300 dark:bg-red-900/30 dark:border-red-700',
};

/**
 * Get Tailwind color classes for a question status.
 *
 * @param {string} status
 * @returns {string}
 */
export function getStatusColor(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.pending;
}

/**
 * Get the Hebrew label for a question status.
 *
 * @param {string} status
 * @returns {string}
 */
export function getStatusLabel(status) {
  return STATUS_LABELS[status] || status || '';
}

// ── Difficulty labels ──────────────────────────────────────────────────────

const DIFFICULTY_LABELS = {
  1: 'קל',
  2: 'בינוני-קל',
  3: 'בינוני',
  4: 'קשה',
  5: 'קשה מאוד',
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
  expert: 'מומחה',
};

/**
 * Get the Hebrew label for a question difficulty level.
 *
 * @param {number|string} level
 * @returns {string}
 */
export function getDifficultyLabel(level) {
  if (!level && level !== 0) return '';
  return DIFFICULTY_LABELS[level] || String(level);
}

// ── Category labels ────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  shabbat: 'שבת ומועדים',
  kashrut: 'כשרות',
  family: 'דיני משפחה',
  prayer: 'תפילה',
  business: 'ממונות',
  general: 'כללי',
  nidda: 'טהרת המשפחה',
  mourning: 'אבלות',
  blessings: 'ברכות',
  other: 'אחר',
};

/**
 * Get the Hebrew label for a question category.
 */
export function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category || '';
}

// ── Number formatting ──────────────────────────────────────────────────────

/**
 * Format a number with Hebrew locale separators.
 * e.g. 1234567 → "1,234,567"
 */
export function formatNumber(num) {
  if (num === null || num === undefined) return '';
  return new Intl.NumberFormat('he-IL').format(num);
}

/**
 * Format a count with short Hebrew suffix for large numbers.
 * e.g. 1234 → "1.2K", 1200000 → "1.2M"
 */
export function formatCount(num) {
  if (!num && num !== 0) return '';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Check if a string is a valid Israeli phone number.
 * Supports: 05X-XXXXXXX, +9725X-XXXXXXX, 05XXXXXXXXX
 */
export function isValidIsraeliPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(\+972|972|0)5[0-9]{8}$/.test(cleaned);
}

/**
 * Check if a string is a valid email address.
 */
export function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Misc ───────────────────────────────────────────────────────────────────

/**
 * Generate a stable color class from a string (for category pills, etc.)
 */
export function colorFromCategory(category) {
  const map = {
    shabbat: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
    kashrut: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    family: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
    prayer: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    business: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    nidda: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
    mourning: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    blessings: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    general: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
    other: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  };
  return map[category] || map.other;
}

/**
 * Debounce a function (non-hook version for use outside components).
 */
export function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Sleep (await sleep(ms)) — for testing/demo only.
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

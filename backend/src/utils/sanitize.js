'use strict';

/**
 * HTML Sanitization & Email Cleaning Utilities
 *
 * Provides server-side HTML sanitization WITHOUT relying on DOMPurify
 * (which is browser-only).  Instead we parse with jsdom and walk the DOM
 * ourselves, keeping only explicitly allowed tags and attributes.
 *
 * Dependencies (in package.json):
 *   jsdom  ^24.x
 *
 * Export surface:
 *   sanitizeRichText(html)       – allow-list HTML tags, strip everything else
 *   stripEmailHistory(text)      – remove quoted reply chains from plain text
 *   cleanEmailText(rawText)      – stripEmailHistory + whitespace trim
 */

const { JSDOM } = require('jsdom');

// ─── Allow-lists ──────────────────────────────────────────────────────────────

/**
 * Tags that editors may use in rich-text answers.
 * Everything not in this set is stripped (content kept, tags removed).
 */
const ALLOWED_TAGS = new Set([
  'p', 'br',
  'b', 'i', 'u', 'strong', 'em',
  'ul', 'ol', 'li',
  'blockquote',
  'h1', 'h2', 'h3', 'h4',
  'a',
]);

/**
 * Per-tag allow-list of attributes.
 * The wildcard key '*' applies to every allowed tag.
 * Attributes not in the relevant set are removed.
 */
const ALLOWED_ATTRS = {
  '*': new Set(['dir']),          // RTL/LTR support on any allowed tag
  'a': new Set(['href', 'target', 'rel']),
};

/**
 * URI schemes that are dangerous inside href values.
 * We strip these even if 'href' is otherwise permitted.
 */
const DANGEROUS_SCHEMES = /^\s*(javascript|vbscript|data)\s*:/i;

// ─── DOM walker ───────────────────────────────────────────────────────────────

/**
 * Recursively sanitize a DOM node in place.
 *
 * Algorithm:
 *  - Text nodes:  keep as-is.
 *  - Element nodes that are in ALLOWED_TAGS:
 *      • Remove any attribute not in ALLOWED_ATTRS.
 *      • For <a> additionally scrub dangerous href schemes and enforce rel.
 *      • Recurse into children.
 *  - Element nodes NOT in ALLOWED_TAGS:
 *      • Replace the element with its children (keep text, drop the tag).
 *      • Recurse into the promoted children.
 *  - Any other node type (comment, CDATA, PI…): remove entirely.
 *
 * @param {Node}     node       – current DOM node
 * @param {Document} document   – owning document (needed for createTextNode)
 */
function sanitizeNode(node, document) {
  // Nothing to do for text nodes
  if (node.nodeType === node.TEXT_NODE) {
    return;
  }

  // Remove comments, processing instructions, CDATA, etc.
  if (node.nodeType !== node.ELEMENT_NODE) {
    node.parentNode && node.parentNode.removeChild(node);
    return;
  }

  const tagName = node.tagName.toLowerCase();

  if (ALLOWED_TAGS.has(tagName)) {
    // ── Sanitize attributes ──
    const attrNames = Array.from(node.attributes).map((a) => a.name);
    const globalAllowed  = ALLOWED_ATTRS['*']        || new Set();
    const tagAllowed     = ALLOWED_ATTRS[tagName]    || new Set();

    for (const attr of attrNames) {
      if (!globalAllowed.has(attr) && !tagAllowed.has(attr)) {
        node.removeAttribute(attr);
      }
    }

    // ── Extra hardening for <a> ──
    if (tagName === 'a') {
      const href = node.getAttribute('href') || '';
      if (DANGEROUS_SCHEMES.test(href)) {
        node.removeAttribute('href');
      }
      // Always enforce safe link-opening behaviour
      node.setAttribute('rel', 'noopener noreferrer');
      // Default to blank target for external links; keep existing if set
      if (!node.hasAttribute('target')) {
        node.setAttribute('target', '_blank');
      }
    }

    // ── Recurse into children (snapshot first — mutation-safe) ──
    const children = Array.from(node.childNodes);
    for (const child of children) {
      sanitizeNode(child, document);
    }

  } else {
    // ── Unwrap: replace element with its children ──
    const parent   = node.parentNode;
    const children = Array.from(node.childNodes);

    for (const child of children) {
      parent.insertBefore(child, node);
    }
    parent.removeChild(node);

    // Recurse into the newly promoted children
    for (const child of children) {
      sanitizeNode(child, document);
    }
  }
}

// ─── sanitizeRichText ─────────────────────────────────────────────────────────

/**
 * Strip dangerous HTML while preserving the allowed rich-text subset.
 *
 * Uses jsdom to parse the fragment into a real DOM, walks every node with
 * the sanitizeNode walker above, then serialises back to an HTML string.
 *
 * @param {string} html  – raw HTML (from a form or email)
 * @returns {string}     – safe HTML string, empty string on bad input
 */
function sanitizeRichText(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  let dom;
  try {
    // Parse as a full document; we will extract body content
    dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
      // Disable features we do not need (improves performance + safety)
      runScripts:          'outside-only',
      resources:           'usable',
      pretendToBeVisual:   false,
    });
  } catch (err) {
    console.error('[sanitizeRichText] jsdom parse error:', err.message);
    return '';
  }

  const { document } = dom.window;
  const body         = document.body;

  // Walk and sanitize every child of <body>
  const children = Array.from(body.childNodes);
  for (const child of children) {
    sanitizeNode(child, document);
  }

  return body.innerHTML;
}

// ─── stripEmailHistory ────────────────────────────────────────────────────────

/**
 * Patterns that mark the start of a quoted email thread / signature.
 * Text from the first matching line onwards is discarded.
 * More-specific patterns are tested first.
 */
const REPLY_BOUNDARY_PATTERNS = [
  // Gmail/Apple/Outlook "On <date> ... wrote:" (subject may span two lines)
  /^On .{0,200}wrote:\s*$/i,
  // Standard plain-text quoting: line begins with '>'
  /^>/,
  // Outlook separator "-----Original Message-----"
  /^-{3,}\s*original message\s*-{3,}/i,
  // Hebrew mobile signature "נשלח מ" (e.g. "נשלח מ-iPhone")
  /^נשלח מ/,
  // English mobile signature "Sent from" (e.g. "Sent from my iPhone")
  /^Sent from /i,
  // RFC 3676 signature delimiter: standalone "-- "
  /^--\s*$/,
  // Email header lines in forwarded blocks
  /^From:/i,
  /^To:/i,
  /^Subject:/i,
  /^Date:/i,
  // Outlook horizontal rule of underscores
  /^_{8,}/,
  // Common divider lines "---", "***", "==="
  /^[-=*]{3,}\s*$/,
];

/**
 * Remove email reply chains and signatures from a plain-text email body.
 *
 * Keeps only the text that appears ABOVE the first boundary line.
 * Trailing blank lines are removed and runs of 3+ newlines collapsed to 2.
 *
 * @param {string} text  – full plain-text email body
 * @returns {string}     – cleaned reply text
 */
function stripEmailHistory(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const lines = text.split(/\r?\n/);

  let boundaryIndex = lines.length; // default: keep everything
  for (let i = 0; i < lines.length; i++) {
    if (REPLY_BOUNDARY_PATTERNS.some((re) => re.test(lines[i]))) {
      boundaryIndex = i;
      break;
    }
  }

  const contentLines = lines.slice(0, boundaryIndex);
  const joined       = contentLines.join('\n');

  return joined
    .replace(/[ \t]+$/gm, '')   // strip trailing whitespace per line
    .replace(/\n{3,}/g, '\n\n') // collapse 3+ blank lines
    .trim();
}

// ─── cleanEmailText ───────────────────────────────────────────────────────────

/**
 * Full pipeline for cleaning a raw inbound email body:
 *   1. stripEmailHistory – remove quoted reply chains & signatures
 *   2. trim             – remove leading/trailing whitespace
 *
 * @param {string} rawText  – raw plain-text email body
 * @returns {string}        – cleaned text ready for storage
 */
function cleanEmailText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return '';
  }
  return stripEmailHistory(rawText).trim();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  sanitizeRichText,
  stripEmailHistory,
  cleanEmailText,
};

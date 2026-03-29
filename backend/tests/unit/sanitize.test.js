'use strict';

/**
 * Unit tests for HTML sanitization (src/utils/sanitize.js)
 *
 * Tests sanitizeRichText, stripEmailHistory, and cleanEmailText.
 * Uses the real jsdom-based sanitizer.
 */

const {
  sanitizeRichText,
  stripEmailHistory,
  cleanEmailText,
} = require('../../src/utils/sanitize');

// ─── sanitizeRichText ────────────────────────────────────────────────────────

describe('sanitizeRichText', () => {
  // --- XSS payload stripping ---

  test('strips <script> tags', () => {
    const input = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('</script');
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  test('strips onerror and other event handler attributes', () => {
    const input = '<p onerror="alert(1)" onclick="hack()">Text</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('onclick');
    expect(result).toContain('Text');
  });

  test('strips javascript: URIs from anchor href', () => {
    const input = '<a href="javascript:alert(1)">Click me</a>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('Click me');
  });

  test('strips data: URIs from anchor href', () => {
    const input = '<a href="data:text/html,<script>alert(1)</script>">Link</a>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('data:');
  });

  test('strips <img> tags (not in allowed list)', () => {
    const input = '<img src="x" onerror="alert(1)"><p>Safe</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('<img');
    expect(result).toContain('Safe');
  });

  test('strips <iframe> tags', () => {
    const input = '<iframe src="https://evil.com"></iframe><p>OK</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('<iframe');
    expect(result).toContain('OK');
  });

  test('strips style attributes', () => {
    const input = '<p style="background:url(javascript:alert(1))">Text</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('style=');
    expect(result).toContain('Text');
  });

  // --- Valid HTML preservation ---

  test('preserves allowed tags: p, b, i, u, strong, em', () => {
    const input = '<p><strong>Bold</strong> and <em>italic</em> and <u>underline</u></p>';
    const result = sanitizeRichText(input);
    expect(result).toContain('<strong>');
    expect(result).toContain('<em>');
    expect(result).toContain('<u>');
    expect(result).toContain('<p>');
  });

  test('preserves list elements', () => {
    const input = '<ul><li>Item 1</li><li>Item 2</li></ul>';
    const result = sanitizeRichText(input);
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
  });

  test('preserves blockquote', () => {
    const input = '<blockquote>A quote</blockquote>';
    const result = sanitizeRichText(input);
    expect(result).toContain('<blockquote>');
  });

  test('preserves safe <a> with href and adds rel/target', () => {
    const input = '<a href="https://example.com">Link</a>';
    const result = sanitizeRichText(input);
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  test('preserves dir attribute (RTL support)', () => {
    const input = '<p dir="rtl">Hebrew text</p>';
    const result = sanitizeRichText(input);
    expect(result).toContain('dir="rtl"');
  });

  // --- Empty/null input handling ---

  test('returns empty string for null input', () => {
    expect(sanitizeRichText(null)).toBe('');
  });

  test('returns empty string for undefined input', () => {
    expect(sanitizeRichText(undefined)).toBe('');
  });

  test('returns empty string for empty string input', () => {
    expect(sanitizeRichText('')).toBe('');
  });

  test('returns empty string for non-string input', () => {
    expect(sanitizeRichText(123)).toBe('');
    expect(sanitizeRichText({})).toBe('');
  });
});

// ─── stripEmailHistory ───────────────────────────────────────────────────────

describe('stripEmailHistory', () => {
  test('strips quoted reply lines starting with >', () => {
    const input = 'My reply\n> Original message\n> More original';
    const result = stripEmailHistory(input);
    expect(result).toBe('My reply');
  });

  test('strips "On ... wrote:" pattern', () => {
    const input = 'My reply\nOn Mon, Jan 1, 2024 at 10:00 AM John wrote:\nOriginal';
    const result = stripEmailHistory(input);
    expect(result).toBe('My reply');
  });

  test('strips "Sent from" signature', () => {
    const input = 'My reply\nSent from my iPhone';
    const result = stripEmailHistory(input);
    expect(result).toBe('My reply');
  });

  test('returns empty string for null input', () => {
    expect(stripEmailHistory(null)).toBe('');
  });

  test('returns full text when no boundary found', () => {
    const input = 'Just a plain message\nWith two lines';
    const result = stripEmailHistory(input);
    expect(result).toBe('Just a plain message\nWith two lines');
  });
});

// ─── cleanEmailText ──────────────────────────────────────────────────────────

describe('cleanEmailText', () => {
  test('returns empty string for null', () => {
    expect(cleanEmailText(null)).toBe('');
  });

  test('trims whitespace and strips history', () => {
    const input = '  Hello World  \n\nSent from my iPhone';
    const result = cleanEmailText(input);
    expect(result).toBe('Hello World');
  });
});

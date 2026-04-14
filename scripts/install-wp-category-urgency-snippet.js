#!/usr/bin/env node
'use strict';

/**
 * Install or update the Category + Urgency snippet on WordPress.
 *
 * Usage:
 *   cd backend && node ../scripts/install-wp-category-urgency-snippet.js
 *
 * Requires: WP_API_URL and WP_API_KEY in backend/.env
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const url  = (process.env.WP_API_URL || '').replace('/wp/v2', '');
const key  = process.env.WP_API_KEY;

if (!url || !key) {
  console.error('Missing WP_API_URL or WP_API_KEY in backend/.env');
  process.exit(1);
}

const cred    = key.includes(':') ? Buffer.from(key).toString('base64') : key;
const headers = { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' };

const phpFile = path.join(__dirname, 'wp-snippet-category-urgency.php');
let phpCode   = fs.readFileSync(phpFile, 'utf8');

// Remove opening <?php tag (Code Snippets adds it automatically)
phpCode = phpCode.replace(/^<\?php\s*/, '').trim();

const SNIPPET_NAME = 'Ask-Rabai: Category + Urgency Fields';

(async () => {
  try {
    // First check if snippet already exists
    const list = await axios.get(`${url}/code-snippets/v1/snippets`, {
      headers,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    });

    const existing = list.data.find(s => s.name === SNIPPET_NAME);

    if (existing) {
      // Update existing snippet
      await axios.put(`${url}/code-snippets/v1/snippets/${existing.id}`, {
        code:   phpCode,
        active: true,
      }, {
        headers,
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      });
      console.log(`✓ Updated existing snippet ID ${existing.id} ("${SNIPPET_NAME}") — Active`);
    } else {
      // Create new snippet
      const res = await axios.post(`${url}/code-snippets/v1/snippets`, {
        name:   SNIPPET_NAME,
        code:   phpCode,
        active: true,
        scope:  'global',
        desc:   'Adds category (ask-cat taxonomy) and urgency dropdown fields to the ask-rabai JetEngine form.',
      }, {
        headers,
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      });
      console.log(`✓ Created new snippet ID ${res.data.id} ("${SNIPPET_NAME}") — Active: ${res.data.active}`);
    }
  } catch (err) {
    console.error('✗ Error:', err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 500));
    process.exit(1);
  }
})();

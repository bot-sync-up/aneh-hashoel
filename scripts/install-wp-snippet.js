#!/usr/bin/env node
'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const url = (process.env.WP_API_URL || '').replace('/wp/v2', '');
const key = process.env.WP_API_KEY;
const cred = key.includes(':') ? Buffer.from(key).toString('base64') : key;
const headers = { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' };

const phpFile = path.join(__dirname, 'wp-snippet-thank-followup.php');
let phpCode = fs.readFileSync(phpFile, 'utf8');

// Remove opening <?php tag
phpCode = phpCode.replace(/^<\?php\s*/, '').trim();

(async () => {
  try {
    const res = await axios.post(`${url}/code-snippets/v1/snippets`, {
      name: 'Thank Button + Follow-up Form',
      code: phpCode,
      active: true,
      scope: 'global',
    }, { headers });
    console.log('✓ Snippet created! ID:', res.data.id, 'Active:', res.data.active);
  } catch (err) {
    if (err.response?.status === 400 && err.response?.data?.message?.includes('already exists')) {
      console.log('Snippet already exists, updating...');
      // Try to find and update
      const list = await axios.get(`${url}/code-snippets/v1/snippets`, { headers });
      const existing = list.data.find(s => s.name?.includes('Thank Button'));
      if (existing) {
        await axios.put(`${url}/code-snippets/v1/snippets/${existing.id}`, {
          code: phpCode,
          active: true,
        }, { headers });
        console.log('✓ Updated snippet', existing.id);
      }
    } else {
      console.error('✗ Error:', err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 300));
    }
  }
})();

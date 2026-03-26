#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { query } = require('./src/db/pool');

(async () => {
  const { rows } = await query(
    `SELECT id, content, content_versions FROM answers
     WHERE content_versions::text LIKE '%test%'
        OR content LIKE '%test%'
        OR content LIKE '%dir=%signature%'`
  );
  console.log('Found', rows.length, 'answers to clean');

  for (const row of rows) {
    let content = row.content || '';
    content = content.replace(/<div dir="rtl" style="margin-top:1em">.*?<\/div>/gs, '');
    content = content.replace(/<p dir="rtl"><p>test<\/p><\/p>/g, '');

    let versions = row.content_versions || [];
    if (typeof versions === 'string') versions = JSON.parse(versions);
    versions = versions.map(v => ({
      ...v,
      content: (v.content || '')
        .replace(/<div dir="rtl" style="margin-top:1em">.*?<\/div>/gs, '')
        .replace(/<p dir="rtl"><p>test<\/p><\/p>/g, '')
    }));

    await query(
      'UPDATE answers SET content = $1, content_versions = $2 WHERE id = $3',
      [content, JSON.stringify(versions), row.id]
    );
    console.log('Cleaned', row.id);
  }
  console.log('Done');
  process.exit();
})();

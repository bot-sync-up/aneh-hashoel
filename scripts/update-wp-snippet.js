#!/usr/bin/env node
'use strict';

require('dotenv').config();

const axios = require('axios');
const url = (process.env.WP_API_URL || '').replace('/wp/v2', '');
const key = process.env.WP_API_KEY;
const cred = key.includes(':') ? Buffer.from(key).toString('base64') : key;
const headers = { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' };

const phpCode = `
/**
 * Fix: Save visitor_email and visitor_phone from JetEngine form to post meta.
 * Uses save_post hook which fires for ALL post saves including JetEngine.
 */
add_action('save_post_ask-rabai', function($post_id, $post, $update) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (wp_is_post_revision($post_id)) return;

    $values = isset($_POST['values']) ? $_POST['values'] : array();
    if (is_string($values)) $values = json_decode($values, true);
    if (!is_array($values)) $values = array();

    $email_keys = array('visitor_email', 'visitor-email', 'email', 'asker_email');
    $phone_keys = array('visitor_phone', 'visitor-phone', 'phone', 'asker_phone');

    $email = '';
    foreach ($email_keys as $k) {
        if (!empty($values[$k])) { $email = sanitize_email($values[$k]); break; }
        if (!empty($_POST[$k]))  { $email = sanitize_email($_POST[$k]); break; }
    }

    $phone = '';
    foreach ($phone_keys as $k) {
        if (!empty($values[$k])) { $phone = sanitize_text_field($values[$k]); break; }
        if (!empty($_POST[$k]))  { $phone = sanitize_text_field($_POST[$k]); break; }
    }

    if ($email) update_post_meta($post_id, 'visitor_email', $email);
    if ($phone) update_post_meta($post_id, 'visitor_phone', $phone);

    // Debug: log what we found
    update_post_meta($post_id, 'debug_email_fix', wp_json_encode(array(
        'email' => $email ?: '(empty)',
        'phone' => $phone ?: '(empty)',
        'values_keys' => array_keys($values),
        'post_keys' => array_keys($_POST),
        'time' => current_time('mysql'),
    )));
}, 5, 3);
`;

(async () => {
  try {
    const res = await axios.put(`${url}/code-snippets/v1/snippets/24`, {
      code: phpCode.trim(),
      active: true,
    }, { headers });
    console.log('✓ Snippet updated! ID:', res.data.id, 'Active:', res.data.active);
  } catch (err) {
    console.error('✗ Error:', err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 300));
  }
})();

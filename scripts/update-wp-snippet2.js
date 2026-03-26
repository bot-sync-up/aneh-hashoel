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
 * Fix: Intercept JetEngine form AJAX + save_post to capture email/phone.
 *
 * Strategy:
 * 1. On init: if this is a JetEngine form AJAX, parse values and store in global
 * 2. On save_post: check global for email/phone and save to meta
 * 3. Also try wp_insert_post_data filter as backup
 */

// Step 1: Capture JetEngine form values early in the request
add_action('init', function() {
    // JetEngine forms submit via AJAX with action containing 'jet_engine' or 'jet-form'
    $action = isset($_POST['action']) ? $_POST['action'] : '';
    if (strpos($action, 'jet') === false) return;

    $values = isset($_POST['values']) ? $_POST['values'] : '';
    if (is_string($values) && !empty($values)) {
        $decoded = json_decode(stripslashes($values), true);
        if (is_array($decoded)) {
            $GLOBALS['_jet_form_values'] = $decoded;
        }
    }
}, 1);

// Step 2: On ANY post insert/update, check if we have JetEngine form values
add_action('wp_insert_post', function($post_id, $post, $update) {
    // Only for ask-rabai
    if ($post->post_type !== 'ask-rabai') return;
    if (wp_is_post_revision($post_id)) return;

    $values = isset($GLOBALS['_jet_form_values']) ? $GLOBALS['_jet_form_values'] : array();

    // Also check direct POST
    $all_sources = array_merge(
        $values,
        $_POST
    );

    $email_keys = array('visitor_email', 'visitor-email', 'email', 'asker_email', 'ask-email');
    $phone_keys = array('visitor_phone', 'visitor-phone', 'phone', 'asker_phone', 'ask-phone');

    $email = '';
    foreach ($email_keys as $k) {
        if (!empty($all_sources[$k])) { $email = sanitize_email($all_sources[$k]); break; }
    }

    $phone = '';
    foreach ($phone_keys as $k) {
        if (!empty($all_sources[$k])) { $phone = sanitize_text_field($all_sources[$k]); break; }
    }

    if ($email && empty(get_post_meta($post_id, 'visitor_email', true))) {
        update_post_meta($post_id, 'visitor_email', $email);
    }
    if ($phone && empty(get_post_meta($post_id, 'visitor_phone', true))) {
        update_post_meta($post_id, 'visitor_phone', $phone);
    }

    // Debug log - always write to see if hook fires
    update_post_meta($post_id, 'debug_email_fix', wp_json_encode(array(
        'hook' => 'wp_insert_post',
        'email' => $email ?: '(empty)',
        'phone' => $phone ?: '(empty)',
        'values_keys' => array_keys($values),
        'post_keys' => array_keys($_POST),
        'action' => isset($_POST['action']) ? $_POST['action'] : '(none)',
        'time' => current_time('mysql'),
    )));
}, 5, 3);
`;

(async () => {
  try {
    const res = await axios.put(`${url}/code-snippets/v1/snippets/24`, {
      name: 'Fix JetEngine email/phone meta save v3',
      code: phpCode.trim(),
      active: true,
    }, { headers });
    console.log('✓ Snippet updated! ID:', res.data.id, 'Active:', res.data.active);
  } catch (err) {
    console.error('✗ Error:', err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 500));
  }
})();

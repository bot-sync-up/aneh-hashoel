#!/usr/bin/env node
'use strict';

require('dotenv').config();

const axios = require('axios');
const url = (process.env.WP_API_URL || '').replace('/wp/v2', '');
const key = process.env.WP_API_KEY;
const cred = key.includes(':') ? Buffer.from(key).toString('base64') : key;
const headers = { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' };

// Update snippet 23 (the DIAGNOSTIC one that already works) to also save email/phone
const phpCode = `
// Register debug_form_data for REST API
add_action('init', function() {
    register_post_meta('ask-rabai', 'debug_form_data', [
        'show_in_rest' => true, 'single' => true, 'type' => 'string', 'auth_callback' => '__return_true'
    ]);
});

// Save form debug data + extract email/phone on new ask-rabai post
add_action('save_post_ask-rabai', function($post_id, $post, $update) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if ($update && get_post_meta($post_id, 'debug_form_data', true)) return;

    // Parse JetEngine form values from POST
    $values = isset($_POST['values']) ? $_POST['values'] : '';
    if (is_string($values) && !empty($values)) {
        $values = json_decode(stripslashes($values), true);
    }
    if (!is_array($values)) $values = array();

    // === EMAIL/PHONE EXTRACTION ===
    $email_keys = array('visitor_email', 'visitor-email', 'email', 'asker_email', 'ask-email');
    $phone_keys = array('visitor_phone', 'visitor-phone', 'phone', 'asker_phone', 'ask-phone');

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

    // Save email and phone to meta
    if ($email) update_post_meta($post_id, 'visitor_email', $email);
    if ($phone) update_post_meta($post_id, 'visitor_phone', $phone);

    // Debug log with everything
    $debug = [
        'POST_keys'   => array_keys($_POST),
        'FILES'       => $_FILES ? array_map(function($f){ return ['name'=>$f['name'],'size'=>$f['size'],'error'=>$f['error'],'tmp'=>$f['tmp_name']]; }, $_FILES) : [],
        'all_meta'    => array_map('maybe_unserialize', array_map('current', get_post_meta($post_id))),
        'values_keys' => array_keys($values),
        'email_found' => $email ?: '(empty)',
        'phone_found' => $phone ?: '(empty)',
    ];
    update_post_meta($post_id, 'debug_form_data', json_encode($debug, JSON_UNESCAPED_UNICODE));
}, 999, 3);
`;

(async () => {
  try {
    // Update snippet 23 (the working diagnostic one)
    const res = await axios.put(`${url}/code-snippets/v1/snippets/23`, {
      name: 'ASK-RABAI: Debug + Email/Phone Fix',
      code: phpCode.trim(),
      active: true,
    }, { headers });
    console.log('✓ Snippet 23 updated! Active:', res.data.active);

    // Deactivate snippet 24 (our broken one)
    await axios.put(`${url}/code-snippets/v1/snippets/24`, {
      active: false,
    }, { headers });
    console.log('✓ Snippet 24 deactivated');
  } catch (err) {
    console.error('✗ Error:', err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 500));
  }
})();

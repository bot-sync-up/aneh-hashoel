#!/usr/bin/env node
'use strict';
require('dotenv').config();
const axios = require('axios');
const url = (process.env.WP_API_URL || '').replace('/wp/v2', '');
const key = process.env.WP_API_KEY;
const cred = key.includes(':') ? Buffer.from(key).toString('base64') : key;
const headers = { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' };

const phpCode = `
// Register debug_form_data for REST API
add_action('init', function() {
    register_post_meta('ask-rabai', 'debug_form_data', [
        'show_in_rest' => true, 'single' => true, 'type' => 'string', 'auth_callback' => '__return_true'
    ]);
});

add_action('save_post_ask-rabai', function($post_id, $post, $update) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if ($update && get_post_meta($post_id, 'debug_form_data', true)) return;

    // Parse JetEngine form values
    $raw_values = isset($_POST['values']) ? $_POST['values'] : '';
    if (is_string($raw_values) && !empty($raw_values)) {
        $values = json_decode(stripslashes($raw_values), true);
    } else {
        $values = is_array($raw_values) ? $raw_values : array();
    }

    // JetEngine sends values as indexed array — search ALL values for email pattern
    $email = '';
    $phone = '';
    $values_dump = array();

    if (is_array($values)) {
        foreach ($values as $k => $v) {
            if (is_string($v)) {
                $v = trim($v);
                $values_dump[$k] = $v;
                // Detect email by pattern
                if (!$email && filter_var($v, FILTER_VALIDATE_EMAIL)) {
                    $email = sanitize_email($v);
                }
                // Detect phone by pattern (starts with 0 or + and has 7+ digits)
                if (!$phone && preg_match('/^[+0][\\d\\s\\-()]{6,}$/', $v)) {
                    $phone = sanitize_text_field($v);
                }
            } elseif (is_array($v)) {
                $values_dump[$k] = '(array:' . count($v) . ')';
            }
        }
    }

    // Also check named keys (in case some forms send associative)
    $named_email_keys = array('visitor_email', 'visitor-email', 'email', 'asker_email');
    $named_phone_keys = array('visitor_phone', 'visitor-phone', 'phone', 'asker_phone');
    foreach ($named_email_keys as $ek) {
        if (!$email && !empty($values[$ek])) $email = sanitize_email($values[$ek]);
        if (!$email && !empty($_POST[$ek]))  $email = sanitize_email($_POST[$ek]);
    }
    foreach ($named_phone_keys as $pk) {
        if (!$phone && !empty($values[$pk])) $phone = sanitize_text_field($values[$pk]);
        if (!$phone && !empty($_POST[$pk]))  $phone = sanitize_text_field($_POST[$pk]);
    }

    // Save to meta
    if ($email) update_post_meta($post_id, 'visitor_email', $email);
    if ($phone) update_post_meta($post_id, 'visitor_phone', $phone);

    // Full debug
    $debug = [
        'POST_keys'     => array_keys($_POST),
        'FILES'         => [],
        'all_meta'      => array_map('maybe_unserialize', array_map('current', get_post_meta($post_id))),
        'values_dump'   => $values_dump,
        'email_found'   => $email ?: '(empty)',
        'phone_found'   => $phone ?: '(empty)',
    ];
    update_post_meta($post_id, 'debug_form_data', json_encode($debug, JSON_UNESCAPED_UNICODE));
}, 999, 3);
`;

(async () => {
  try {
    const res = await axios.put(`${url}/code-snippets/v1/snippets/23`, {
      name: 'ASK-RABAI: Debug + Email/Phone Fix v4',
      code: phpCode.trim(),
      active: true,
    }, { headers });
    console.log('✓ Snippet 23 updated to v4! Active:', res.data.active);
  } catch (err) {
    console.error('✗', err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 500));
  }
})();

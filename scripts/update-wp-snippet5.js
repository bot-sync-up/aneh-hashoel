#!/usr/bin/env node
'use strict';
require('dotenv').config();
const axios = require('axios');
const url = (process.env.WP_API_URL || '').replace('/wp/v2', '');
const key = process.env.WP_API_KEY;
const cred = key.includes(':') ? Buffer.from(key).toString('base64') : key;
const headers = { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' };

const phpCode = `
add_action('init', function() {
    register_post_meta('ask-rabai', 'debug_form_data', [
        'show_in_rest' => true, 'single' => true, 'type' => 'string', 'auth_callback' => '__return_true'
    ]);
});

add_action('save_post_ask-rabai', function($post_id, $post, $update) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if ($update && get_post_meta($post_id, 'debug_form_data', true)) return;

    $raw_values = isset($_POST['values']) ? $_POST['values'] : '';
    if (is_string($raw_values) && !empty($raw_values)) {
        $values = json_decode(stripslashes($raw_values), true);
    } else {
        $values = is_array($raw_values) ? $raw_values : array();
    }

    // JetEngine sends values as array of [field_name, field_value] pairs
    // OR as array of {name: ..., value: ...} objects
    // Flatten into associative array
    $flat = array();
    $raw_dump = array();
    if (is_array($values)) {
        foreach ($values as $k => $v) {
            $raw_dump[$k] = $v; // keep raw for debug
            if (is_array($v)) {
                // Could be [name, value] pair
                if (isset($v[0]) && isset($v[1]) && is_string($v[0])) {
                    $flat[$v[0]] = $v[1];
                }
                // Could be {name: ..., value: ...}
                if (isset($v['name']) && isset($v['value'])) {
                    $flat[$v['name']] = $v['value'];
                }
                // Could be {key: ..., value: ...}
                if (isset($v['key']) && isset($v['value'])) {
                    $flat[$v['key']] = $v['value'];
                }
            } elseif (is_string($v) || is_numeric($v)) {
                $flat[$k] = $v;
            }
        }
    }

    // Search for email and phone in flattened values
    $email = '';
    $phone = '';

    // First try named keys
    $email_keys = array('visitor_email', 'visitor-email', 'email', 'asker_email', 'ask-email', 'field_email');
    $phone_keys = array('visitor_phone', 'visitor-phone', 'phone', 'asker_phone', 'ask-phone', 'field_phone');

    foreach ($email_keys as $ek) {
        if (!$email && !empty($flat[$ek])) $email = sanitize_email($flat[$ek]);
    }
    foreach ($phone_keys as $pk) {
        if (!$phone && !empty($flat[$pk])) $phone = sanitize_text_field($flat[$pk]);
    }

    // Fallback: scan all values for email/phone patterns
    if (!$email || !$phone) {
        foreach ($flat as $fk => $fv) {
            if (is_string($fv)) {
                $fv = trim($fv);
                if (!$email && filter_var($fv, FILTER_VALIDATE_EMAIL)) {
                    $email = sanitize_email($fv);
                }
                if (!$phone && preg_match('/^[+0][\\\\d\\\\s\\\\-()]{6,}$/', $fv)) {
                    $phone = sanitize_text_field($fv);
                }
            }
        }
    }

    if ($email) update_post_meta($post_id, 'visitor_email', $email);
    if ($phone) update_post_meta($post_id, 'visitor_phone', $phone);

    $debug = [
        'POST_keys'    => array_keys($_POST),
        'FILES'        => [],
        'all_meta'     => array_map('maybe_unserialize', array_map('current', get_post_meta($post_id))),
        'flat_values'  => $flat,
        'raw_first_3'  => array_slice($raw_dump, 0, 3),
        'email_found'  => $email ?: '(empty)',
        'phone_found'  => $phone ?: '(empty)',
    ];
    update_post_meta($post_id, 'debug_form_data', json_encode($debug, JSON_UNESCAPED_UNICODE));
}, 999, 3);
`;

(async () => {
  try {
    const res = await axios.put(`${url}/code-snippets/v1/snippets/23`, {
      name: 'ASK-RABAI: Debug + Email/Phone Fix v5',
      code: phpCode.trim(),
      active: true,
    }, { headers });
    console.log('✓ Updated to v5! Active:', res.data.active);
  } catch (err) {
    console.error('✗', err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 500));
  }
})();

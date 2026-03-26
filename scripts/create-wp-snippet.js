#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const axios = require('axios');
const url = (process.env.WP_API_URL || '').replace('/wp/v2', '');
const key = process.env.WP_API_KEY;
const cred = key.includes(':') ? Buffer.from(key).toString('base64') : key;
const headers = { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' };

const phpCode = `
/**
 * Fix JetEngine form: save visitor_email and visitor_phone to post meta
 * when a new question (ask-rabai) is submitted.
 */
add_action('jet-engine/forms/handler/after-do-action/insert_post', function($action, $handler) {
    $post_id = isset($action->data['inserted_post_id']) ? $action->data['inserted_post_id'] : 0;
    if (!$post_id && isset($handler->response_data['inserted_post_id'])) {
        $post_id = $handler->response_data['inserted_post_id'];
    }
    if (!$post_id) return;

    if (get_post_type($post_id) !== 'ask-rabai') return;

    $values = isset($_POST['values']) ? $_POST['values'] : array();
    if (is_string($values)) $values = json_decode($values, true);
    if (!is_array($values)) $values = array();

    $email_fields = array('visitor_email', 'visitor-email', 'email', 'asker_email', 'ask-email', 'field_email');
    $phone_fields = array('visitor_phone', 'visitor-phone', 'phone', 'asker_phone', 'ask-phone', 'field_phone');

    $email = '';
    foreach ($email_fields as $k) {
        if (!empty($values[$k])) { $email = sanitize_email($values[$k]); break; }
        if (!empty($_POST[$k]))  { $email = sanitize_email($_POST[$k]); break; }
    }

    $phone = '';
    foreach ($phone_fields as $k) {
        if (!empty($values[$k])) { $phone = sanitize_text_field($values[$k]); break; }
        if (!empty($_POST[$k]))  { $phone = sanitize_text_field($_POST[$k]); break; }
    }

    if ($email) update_post_meta($post_id, 'visitor_email', $email);
    if ($phone) update_post_meta($post_id, 'visitor_phone', $phone);

    // Update debug log with values keys for troubleshooting
    update_post_meta($post_id, 'debug_email_fix', wp_json_encode(array(
        'email_found' => $email ?: '(empty)',
        'phone_found' => $phone ?: '(empty)',
        'values_keys' => array_keys($values),
        'post_keys'   => array_keys($_POST),
    )));
}, 20, 2);
`;

const snippet = {
  name: 'Fix JetEngine email/phone meta save',
  code: phpCode.trim(),
  active: true,
  scope: 'global',
  priority: 10,
  desc: 'Saves visitor_email and visitor_phone from JetEngine form values to post meta on ask-rabai submissions',
};

(async () => {
  try {
    const res = await axios.post(`${url}/code-snippets/v1/snippets`, snippet, { headers });
    console.log('✓ Snippet created! ID:', res.data.id, 'Active:', res.data.active);
  } catch (err) {
    console.error('✗ Error:', err.response?.status, err.response?.data?.message || err.message);
  }
})();

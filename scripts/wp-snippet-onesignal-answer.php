<?php
/**
 * WP Snippet: OneSignal Push Notification on Answer Publish
 *
 * The OneSignal plugin normally fires pushes on `publish_post` — but our
 * system publishes answers by updating the `ask-answ` meta on an already-
 * published ask-rabai post, which does NOT trigger publish_post. This
 * snippet bridges the gap:
 *
 *   updated_post_meta (ask-answ, first non-empty value)
 *     → fetch OneSignal credentials from OneSignalWPSetting option
 *     → POST to https://onesignal.com/api/v1/notifications
 *
 * Fires ONCE per post (guarded by _aneh_push_sent meta flag).
 *
 * Deployed to moreshet-maran.com as a new Code Snippet. No env vars or
 * extra plugin configuration required — uses whatever OneSignal already
 * has in its own settings.
 */

add_action('updated_post_meta', 'aneh_onesignal_on_answer', 10, 4);
add_action('added_post_meta',   'aneh_onesignal_on_answer', 10, 4);

function aneh_onesignal_on_answer($meta_id, $post_id, $meta_key, $meta_value) {
    // Only react to the answer meta being set
    if ($meta_key !== 'ask-answ') return;
    if (empty($meta_value) || !trim(wp_strip_all_tags($meta_value))) return;

    // Only for our question post type
    if (get_post_type($post_id) !== 'ask-rabai') return;

    // Fire ONCE per post — prevents duplicates if meta is re-saved later
    $already = get_post_meta($post_id, '_aneh_push_sent', true);
    if (!empty($already)) return;

    // Pull OneSignal credentials from the OneSignal WP plugin's own options
    $settings = get_option('OneSignalWPSetting');
    if (empty($settings) || !is_array($settings)) return;

    $app_id   = $settings['app_id'] ?? null;
    $rest_key = $settings['app_rest_api_key'] ?? null;
    if (empty($app_id) || empty($rest_key)) return;

    $post = get_post($post_id);
    if (!$post) return;

    $title = wp_strip_all_tags($post->post_title ?: 'תשובה חדשה');
    if (function_exists('mb_substr') && mb_strlen($title) > 120) {
        $title = mb_substr($title, 0, 117) . '...';
    }
    $url = get_permalink($post_id);

    $body = [
        'app_id'            => $app_id,
        'included_segments' => ['Subscribed Users'],
        'url'               => $url,
        'headings'          => [
            'he' => 'תשובה חדשה באתר',
            'en' => 'New Answer',
        ],
        'contents'          => [
            'he' => $title,
            'en' => $title,
        ],
    ];

    // Send the notification. wp_remote_post handles timeouts + SSL.
    $response = wp_remote_post('https://onesignal.com/api/v1/notifications', [
        'timeout' => 10,
        'blocking' => false, // fire-and-forget so answer-save stays snappy
        'headers' => [
            'Authorization' => 'Basic ' . $rest_key,
            'Content-Type'  => 'application/json; charset=utf-8',
        ],
        'body'    => wp_json_encode($body),
    ]);

    // Mark sent — even if wp_remote_post returned WP_Error we still mark it
    // so we don't spam the user with retries. Debug via OneSignal dashboard.
    update_post_meta($post_id, '_aneh_push_sent', time());

    // Optional debug log (only if WP_DEBUG_LOG is on)
    if (defined('WP_DEBUG_LOG') && WP_DEBUG_LOG) {
        error_log('[aneh_onesignal] fired for post ' . $post_id . ' - ' . $title);
    }
}

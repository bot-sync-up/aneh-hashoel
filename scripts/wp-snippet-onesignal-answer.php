<?php
/**
 * WP Snippet: Fire OneSignal's normal publish flow when an answer is written
 *
 * Problem:
 *   OneSignal fires on the `publish_post` action, which runs when a post
 *   transitions to 'publish' status. Our system writes answers by
 *   updating the `ask-answ` meta on an already-published ask-rabai post,
 *   so publish_post never fires and subscribers stop getting pushes.
 *
 * Solution:
 *   When the ask-answ meta is first set to a non-empty value, we manually
 *   fire the `publish_post` action with the post object. OneSignal's
 *   handler — and any other plugin that hooks into publish_post — runs
 *   exactly as it would for a fresh publish, meaning subscribers get
 *   push notifications (and any email/other channels OneSignal is
 *   configured for).
 *
 *   Fires ONCE per post (guarded by _aneh_push_sent meta flag).
 *
 *   Requires OneSignal's `allowed_custom_post_types` to include
 *   `ask-rabai` — already configured via a one-shot option update.
 */

add_action('updated_post_meta', 'aneh_fire_publish_on_answer', 10, 4);
add_action('added_post_meta',   'aneh_fire_publish_on_answer', 10, 4);

function aneh_fire_publish_on_answer($meta_id, $post_id, $meta_key, $meta_value) {
    if ($meta_key !== 'ask-answ') return;
    if (empty($meta_value) || !trim(wp_strip_all_tags($meta_value))) return;

    if (get_post_type($post_id) !== 'ask-rabai') return;

    // Fire ONCE per post
    if (!empty(get_post_meta($post_id, '_aneh_push_sent', true))) return;

    $post = get_post($post_id);
    if (!$post || $post->post_status !== 'publish') return;

    // Mark FIRST so reentrant calls inside the hook don't loop
    update_post_meta($post_id, '_aneh_push_sent', time());

    // Fire the same hooks that WordPress fires on a fresh publish:
    //   1. publish_post          — generic publish action
    //   2. publish_{post_type}   — type-specific variant
    //   3. transition_post_status — OneSignal v3 listens here too
    //
    // This triggers OneSignal's notification flow AND any other plugin
    // hooked on publish_post (e.g. email newsletters). Because we only
    // fire ONCE per post (meta guard above), subscribers never get spam.
    do_action('publish_post', $post_id, $post);
    do_action("publish_{$post->post_type}", $post_id, $post);
    do_action('transition_post_status', 'publish', 'publish', $post);

    if (defined('WP_DEBUG_LOG') && WP_DEBUG_LOG) {
        error_log('[aneh_onesignal] fired publish hooks for ask-rabai #' . $post_id);
    }
}

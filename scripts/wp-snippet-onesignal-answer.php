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
 *   ALSO: OneSignal reads two per-post meta fields before actually sending:
 *     - `onesignal_meta_box_present` — "was the editor UI present"
 *     - `send_onesignal_notification` — the opt-in checkbox
 *   These fields come from the $_POST data of the Gutenberg/Classic editor.
 *   When we fire the hook programmatically from a meta-update, those $_POST
 *   values don't exist, so OneSignal bails silently. We need to "pretend"
 *   the checkbox was ticked by setting $_POST AND by populating the meta.
 *
 * Solution:
 *   1. Pre-populate $_POST['send_onesignal_notification'] = '1' and
 *      $_POST['onesignal_meta_box_present'] = '1' so OneSignal's $_POST
 *      reads succeed.
 *   2. Persist the same values as post meta so any later re-entry (cron,
 *      async sender, retry) still sees opt-in.
 *   3. Fire publish_post, publish_{type}, and transition_post_status hooks.
 *
 *   Fires ONCE per post (guarded by _aneh_push_sent meta flag) so the
 *   subscriber never gets the same notification twice.
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

    // ── Force OneSignal opt-in for this post ────────────────────────────────
    // The per-post "Send notification on ask-rabai update" checkbox defaults
    // to UNCHECKED. Because we fire the publish hook from server code (no
    // editor UI), $_POST is empty and OneSignal bails. Pretend the checkbox
    // was ticked by populating both $_POST (for the current request) AND
    // post meta (for any deferred/async sender).

    $_POST['onesignal_meta_box_present']   = '1';
    $_POST['send_onesignal_notification']  = '1';

    update_post_meta($post_id, 'onesignal_meta_box_present',  '1');
    update_post_meta($post_id, 'send_onesignal_notification', '1');

    // ── Fire the hooks WordPress would fire on a fresh publish ─────────────
    //   1. publish_post          — generic publish action
    //   2. publish_{post_type}   — type-specific variant
    //   3. transition_post_status — OneSignal v3 listens here too
    do_action('publish_post', $post_id, $post);
    do_action("publish_{$post->post_type}", $post_id, $post);
    do_action('transition_post_status', 'publish', 'publish', $post);

    if (defined('WP_DEBUG_LOG') && WP_DEBUG_LOG) {
        error_log('[aneh_onesignal] fired publish hooks + opt-in for ask-rabai #' . $post_id);
    }
}

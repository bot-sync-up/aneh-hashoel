<?php
/**
 * Aneh TEMP — flush WP Rocket cache (one-shot trigger)
 *
 * Hit GET /wp-json/aneh-temp/v1/flush (admin-authenticated).
 * Delete this snippet after use.
 */
add_action('rest_api_init', function() {
    register_rest_route('aneh-temp/v1', '/flush', [
        'methods' => 'GET',
        'permission_callback' => function() { return current_user_can('manage_options'); },
        'callback' => function() {
            $cleared = [];
            if (function_exists('rocket_clean_domain')) { rocket_clean_domain(); $cleared[] = 'rocket_clean_domain'; }
            if (function_exists('rocket_clean_minify')) { rocket_clean_minify(); $cleared[] = 'rocket_clean_minify'; }
            if (function_exists('rocket_clean_cache_busting')) { rocket_clean_cache_busting(); $cleared[] = 'rocket_clean_cache_busting'; }
            wp_cache_flush();
            $cleared[] = 'wp_cache_flush';
            return ['cleared' => $cleared, 'time' => time()];
        }
    ]);
});

<?php
/**
 * WP Snippet: Add Category & Urgency dropdowns to ask-rabai JetEngine form
 *
 * Injects two select fields into the JetEngine form (ID 552) on ask-rabai pages:
 *   1. Question category — pulls terms from `ask-cat` taxonomy
 *   2. Urgency level — normal / high / urgent
 *
 * On form submission, saves values to post meta:
 *   - question_category (slug of selected ask-cat term)
 *   - urgency ('normal' / 'high' / 'urgent')
 *
 * Also assigns the selected ask-cat term to the post taxonomy.
 *
 * These fields are already expected by the aneh-hashoel backend webhook
 * (normalisePayload reads meta.question_category and meta.urgency).
 */

// ─── 1. Register meta fields for REST API visibility ────────────────────────

add_action('init', function() {
    register_post_meta('ask-rabai', 'question_category', [
        'type'          => 'string',
        'single'        => true,
        'default'       => '',
        'show_in_rest'  => true,
        'auth_callback' => '__return_true',
    ]);
    register_post_meta('ask-rabai', 'urgency', [
        'type'          => 'string',
        'single'        => true,
        'default'       => 'normal',
        'show_in_rest'  => true,
        'auth_callback' => '__return_true',
    ]);
});

// ─── 2. Inject dropdowns into the form via wp_footer ────────────────────────

add_action('wp_footer', function() {
    // Only on pages that have the ask-rabai form
    // The form is identified by JetEngine form ID 552
    ?>
    <script>
    (function() {
        // Wait for form to exist
        var attempts = 0;
        var timer = setInterval(function() {
            attempts++;
            if (attempts > 30) { clearInterval(timer); return; }

            // Find the JetEngine form — look for the question field
            var questionField = document.querySelector('[name="rabai_question"]');
            if (!questionField) return;
            clearInterval(timer);

            // Find the form element
            var form = questionField.closest('form') || questionField.closest('.jet-form-builder');
            if (!form) return;

            // Find the submit button to insert before it
            var submitBtn = form.querySelector('[type="submit"], .jet-form-builder__submit, .jet-engine-booking-submit');
            if (!submitBtn) return;
            var submitParent = submitBtn.closest('.jet-form-builder__field, .jet-engine-booking-form__field, .jet-form-builder-row') || submitBtn.parentElement;

            // ── Build Category Dropdown ──
            var catHtml = '<div class="jet-form-builder-row aneh-custom-field" style="margin-bottom:16px;">'
                + '<label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px; color:inherit; font-family:inherit;">נושא השאלה</label>'
                + '<select name="question_category" id="aneh-category" '
                + 'style="width:100%; padding:9px 12px; border:1px solid #ccc; border-radius:4px; '
                + 'font-size:14px; font-family:inherit; direction:rtl; background:#fff; outline:none; '
                + '-webkit-appearance:none; appearance:none; cursor:pointer;">'
                + '<option value="">בחר נושא (לא חובה)</option>'
                + '<?php
                    $terms = get_terms([
                        "taxonomy"   => "ask-cat",
                        "hide_empty" => false,
                        "orderby"    => "name",
                        "order"      => "ASC",
                        "parent"     => 0,
                    ]);
                    if (!is_wp_error($terms)) {
                        foreach ($terms as $term) {
                            // Skip test/meta categories
                            if (stripos($term->name, 'בדיקה') !== false) continue;
                            if ($term->slug === 'everything') continue;
                            echo '<option value="' . esc_attr($term->slug) . '">' . esc_html($term->name) . '</option>';
                        }
                    }
                ?>'
                + '</select>'
                + '</div>';

            // ── Build Urgency Dropdown ──
            var urgHtml = '<div class="jet-form-builder-row aneh-custom-field" style="margin-bottom:16px;">'
                + '<label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px; color:inherit; font-family:inherit;">דחיפות</label>'
                + '<select name="urgency" id="aneh-urgency" '
                + 'style="width:100%; padding:9px 12px; border:1px solid #ccc; border-radius:4px; '
                + 'font-size:14px; font-family:inherit; direction:rtl; background:#fff; outline:none; '
                + '-webkit-appearance:none; appearance:none; cursor:pointer;">'
                + '<option value="normal">רגיל</option>'
                + '<option value="high">חשוב \u2014 אשמח לתשובה מהירה</option>'
                + '<option value="urgent">דחוף \u2014 זקוק לתשובה בהקדם</option>'
                + '</select>'
                + '</div>';

            // Insert before submit button
            var container = document.createElement('div');
            container.innerHTML = catHtml + urgHtml;
            while (container.firstChild) {
                submitParent.parentElement.insertBefore(container.firstChild, submitParent);
            }

            // ── Hook into form submission to include our fields ──
            // JetEngine sends form data as `values` array — we need to inject our fields
            form.addEventListener('submit', function() {
                var catVal = document.getElementById('aneh-category');
                var urgVal = document.getElementById('aneh-urgency');

                // Add hidden inputs so JetEngine picks them up in $_POST
                if (catVal && catVal.value) {
                    var h1 = document.createElement('input');
                    h1.type = 'hidden'; h1.name = 'question_category'; h1.value = catVal.value;
                    form.appendChild(h1);
                }
                if (urgVal) {
                    var h2 = document.createElement('input');
                    h2.type = 'hidden'; h2.name = 'urgency'; h2.value = urgVal.value;
                    form.appendChild(h2);
                }
            }, true);
        }, 300);
    })();
    </script>
    <?php
}, 50);

// ─── 3. Save category & urgency on post save ────────────────────────────────

add_action('save_post_ask-rabai', function($post_id, $post, $update) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;

    // Parse JetEngine values (same pattern as snippet #23)
    $raw_values = isset($_POST['values']) ? $_POST['values'] : '';
    if (is_string($raw_values) && !empty($raw_values)) {
        $values = json_decode(stripslashes($raw_values), true);
    } else {
        $values = is_array($raw_values) ? $raw_values : array();
    }

    // Flatten JetEngine values array
    $flat = array();
    if (is_array($values)) {
        foreach ($values as $k => $v) {
            if (is_array($v)) {
                if (isset($v['name']) && isset($v['value'])) $flat[$v['name']] = $v['value'];
                elseif (isset($v['key']) && isset($v['value'])) $flat[$v['key']] = $v['value'];
                elseif (isset($v[0]) && isset($v[1]) && is_string($v[0])) $flat[$v[0]] = $v[1];
            } elseif (is_string($v) || is_numeric($v)) {
                $flat[$k] = $v;
            }
        }
    }

    // Category — check flat values, then direct $_POST
    $cat_slug = '';
    if (!empty($flat['question_category'])) {
        $cat_slug = sanitize_text_field($flat['question_category']);
    } elseif (!empty($_POST['question_category'])) {
        $cat_slug = sanitize_text_field($_POST['question_category']);
    }

    if ($cat_slug) {
        update_post_meta($post_id, 'question_category', $cat_slug);

        // Also assign the taxonomy term to the post
        $term = get_term_by('slug', $cat_slug, 'ask-cat');
        if ($term && !is_wp_error($term)) {
            wp_set_object_terms($post_id, [$term->term_id], 'ask-cat', false);
        }
    }

    // Urgency — default to 'normal'
    $urgency = 'normal';
    if (!empty($flat['urgency']) && in_array($flat['urgency'], ['normal', 'high', 'urgent'])) {
        $urgency = $flat['urgency'];
    } elseif (!empty($_POST['urgency']) && in_array($_POST['urgency'], ['normal', 'high', 'urgent'])) {
        $urgency = $_POST['urgency'];
    }

    update_post_meta($post_id, 'urgency', $urgency);

}, 998, 3);

<?php
/**
 * WP Snippet: Add Urgency dropdown to ask-rabai JetEngine form
 *
 * Injects an urgency select field into the JetEngine form on ask-rabai pages.
 * Category is assigned by the rabbis via the management system, not by the asker.
 *
 * On form submission, saves urgency to post meta:
 *   - urgency ('normal' / 'high' / 'urgent')
 */

// ─── 1. Register meta field for REST API visibility ─────────────────────────

add_action('init', function() {
    register_post_meta('ask-rabai', 'urgency', [
        'type'          => 'string',
        'single'        => true,
        'default'       => 'normal',
        'show_in_rest'  => true,
        'auth_callback' => '__return_true',
    ]);
});

// ─── 2. Inject urgency dropdown into the form via wp_footer ─────────────────

add_action('wp_footer', function() {
    ?>
    <script>
    (function() {
        var attempts = 0;
        var timer = setInterval(function() {
            attempts++;
            if (attempts > 30) { clearInterval(timer); return; }

            var questionField = document.querySelector('[name="rabai_question"]');
            if (!questionField) return;
            clearInterval(timer);

            var form = questionField.closest('form') || questionField.closest('.jet-form-builder');
            if (!form) return;

            var submitBtn = form.querySelector('[type="submit"], .jet-form-builder__submit, .jet-engine-booking-submit');
            if (!submitBtn) return;
            var submitParent = submitBtn.closest('.jet-form-builder__field, .jet-engine-booking-form__field, .jet-form-builder-row') || submitBtn.parentElement;

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

            var container = document.createElement('div');
            container.innerHTML = urgHtml;
            while (container.firstChild) {
                submitParent.parentElement.insertBefore(container.firstChild, submitParent);
            }

            // ── Hook into form submission ──
            form.addEventListener('submit', function() {
                var urgVal = document.getElementById('aneh-urgency');
                if (urgVal) {
                    var h = document.createElement('input');
                    h.type = 'hidden'; h.name = 'urgency'; h.value = urgVal.value;
                    form.appendChild(h);
                }
            }, true);
        }, 300);
    })();
    </script>
    <?php
}, 50);

// ─── 3. Save urgency on post save ──────────────────────────────────────────

add_action('save_post_ask-rabai', function($post_id, $post, $update) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;

    $raw_values = isset($_POST['values']) ? $_POST['values'] : '';
    if (is_string($raw_values) && !empty($raw_values)) {
        $values = json_decode(stripslashes($raw_values), true);
    } else {
        $values = is_array($raw_values) ? $raw_values : array();
    }

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

    // Urgency — default to 'normal'
    $urgency = 'normal';
    if (!empty($flat['urgency']) && in_array($flat['urgency'], ['normal', 'high', 'urgent'])) {
        $urgency = $flat['urgency'];
    } elseif (!empty($_POST['urgency']) && in_array($_POST['urgency'], ['normal', 'high', 'urgent'])) {
        $urgency = $_POST['urgency'];
    }

    update_post_meta($post_id, 'urgency', $urgency);

}, 998, 3);

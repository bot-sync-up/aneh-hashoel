<?php
/**
 * WP Snippet: Thank Button + Follow-up Form for ask-rabai posts
 *
 * Add this as a Code Snippet in WordPress (via Code Snippets plugin)
 * or paste into functions.php of the active theme.
 *
 * Displays:
 * 1. "תודה לרב" button — calls /api/questions/:wp_post_id/wp-thank
 * 2. "שאלת המשך" form — calls /api/questions/:wp_post_id/wp-follow-up
 *
 * Only shows on answered questions (has ask-answ meta field).
 */

// API base URL for the aneh-hashoel backend
define('ANEH_API_URL', 'https://aneh.syncup.co.il/api');

/**
 * Add thank button + follow-up form after ask-rabai post content
 */
add_filter('the_content', function($content) {
    if (!is_singular('ask-rabai')) return $content;

    global $post;
    $answer = get_post_meta($post->ID, 'ask-answ', true);
    if (empty($answer)) return $content; // No answer yet

    $post_id = $post->ID;
    $thank_count = (int) get_post_meta($post->ID, 'thank_count', true);
    $follow_up_count = (int) get_post_meta($post->ID, 'follow_up_count', true);

    // Build the buttons HTML
    $html = '<div id="aneh-actions" style="margin-top:30px; padding:20px; background:#f8f6f1; border-radius:8px; border:1px solid #e0d8c8; direction:rtl; text-align:right; font-family:Heebo,Arial,sans-serif;">';

    // ── Thank Button ──
    $html .= '<div id="aneh-thank-section" style="margin-bottom:20px;">';
    $html .= '<button id="aneh-thank-btn" onclick="anehThank(' . $post_id . ')" style="
        display:inline-flex; align-items:center; gap:8px;
        padding:12px 28px; background:#B8973A; color:#1B2B5E;
        border:none; border-radius:6px; cursor:pointer;
        font-size:16px; font-weight:700; font-family:Heebo,Arial,sans-serif;
        transition:background 0.2s;">
        ❤️ תודה לרב
    </button>';
    $html .= '<span id="aneh-thank-count" style="margin-right:12px; color:#666; font-size:14px;">'
           . ($thank_count > 0 ? $thank_count . ' הודו' : '')
           . '</span>';
    $html .= '<div id="aneh-thank-msg" style="display:none; margin-top:8px; padding:10px 16px; background:#ecfdf5; border:1px solid #6ee7b7; border-radius:6px; color:#065f46; font-size:14px;">תודה רבה! הרב יקבל את הודעתך.</div>';
    $html .= '</div>';

    // ── Follow-up Form (only if no follow-up sent yet) ──
    if ($follow_up_count < 1) {
        $html .= '<div id="aneh-followup-section" style="border-top:1px solid #e0d8c8; padding-top:16px;">';
        $html .= '<h4 style="margin:0 0 10px; color:#1B2B5E; font-size:16px;">שאלת המשך</h4>';
        $html .= '<p style="margin:0 0 10px; color:#666; font-size:13px;">ניתן לשלוח שאלת הבהרה אחת בלבד.</p>';
        $html .= '<div id="aneh-followup-form">';
        $html .= '<input type="email" id="aneh-followup-email" placeholder="האימייל שלך (כפי ששלחת את השאלה)" style="
            width:100%; padding:10px 14px; margin-bottom:8px; border:1px solid #ccc; border-radius:6px;
            font-size:14px; font-family:Heebo,Arial,sans-serif; direction:rtl; box-sizing:border-box;" />';
        $html .= '<textarea id="aneh-followup-content" placeholder="כתוב את שאלת ההמשך שלך..." rows="3" style="
            width:100%; padding:10px 14px; margin-bottom:8px; border:1px solid #ccc; border-radius:6px;
            font-size:14px; font-family:Heebo,Arial,sans-serif; direction:rtl; resize:vertical; box-sizing:border-box;"></textarea>';
        $html .= '<button id="aneh-followup-btn" onclick="anehFollowUp(' . $post_id . ')" style="
            padding:10px 24px; background:#1B2B5E; color:white;
            border:none; border-radius:6px; cursor:pointer;
            font-size:14px; font-weight:600; font-family:Heebo,Arial,sans-serif;">
            שלח שאלת המשך
        </button>';
        $html .= '<div id="aneh-followup-msg" style="display:none; margin-top:8px; padding:10px 16px; border-radius:6px; font-size:14px;"></div>';
        $html .= '</div>';
        $html .= '</div>';
    } else {
        $html .= '<p style="border-top:1px solid #e0d8c8; padding-top:12px; color:#999; font-size:13px;">שאלת המשך כבר נשלחה לשאלה זו.</p>';
    }

    // ── Donation suggestion (appears after thank) ──
    $html .= '<div id="aneh-donate-section" style="display:none; margin-top:16px; padding:16px; background:#fffbf0; border:1px solid #e8d98a; border-radius:8px;">';
    $html .= '<p style="margin:0 0 10px; font-size:15px; color:#1B2B5E; font-weight:700;">התשובה עזרה לך?</p>';
    $html .= '<p style="margin:0 0 12px; font-size:14px; color:#555;">הפעילות הזו מתאפשרת בזכות תורמים. הקדש תרומה להחזקת השרתים והפעילות לזכותך או לעילוי נשמת יקירך.</p>';
    $html .= '<a href="https://moreshet-maran.com/donate" target="_blank" style="
        display:inline-block; padding:12px 28px; background:#B8973A; color:#1B2B5E;
        text-decoration:none; border-radius:6px; font-size:15px; font-weight:700;
        font-family:Heebo,Arial,sans-serif;">
        תרמו עכשיו
    </a>';
    $html .= '</div>';

    $html .= '</div>';

    // ── JavaScript ──
    $html .= '<script>
    var ANEH_API = "' . ANEH_API_URL . '";

    function anehThank(postId) {
        var btn = document.getElementById("aneh-thank-btn");
        btn.disabled = true;
        btn.textContent = "שולח...";

        fetch(ANEH_API + "/questions/" + postId + "/wp-thank", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({visitor_id: localStorage.getItem("aneh_visitor_id") || Math.random().toString(36).slice(2)})
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.error) {
                btn.textContent = data.error;
                setTimeout(function() { btn.textContent = "❤️ תודה לרב"; btn.disabled = false; }, 3000);
            } else {
                btn.textContent = "❤️ תודה נשלחה!";
                btn.style.background = "#10b981";
                btn.style.color = "white";
                document.getElementById("aneh-thank-msg").style.display = "block";
                // Show donation suggestion
                setTimeout(function() {
                    document.getElementById("aneh-donate-section").style.display = "block";
                }, 1500);
                // Update count
                var countEl = document.getElementById("aneh-thank-count");
                var current = parseInt(countEl.textContent) || 0;
                countEl.textContent = (current + 1) + " הודו";
                // Save visitor ID for dedup
                if (!localStorage.getItem("aneh_visitor_id")) {
                    localStorage.setItem("aneh_visitor_id", Math.random().toString(36).slice(2));
                }
            }
        })
        .catch(function() {
            btn.textContent = "שגיאה, נסה שוב";
            btn.disabled = false;
        });
    }

    function anehFollowUp(postId) {
        var email = document.getElementById("aneh-followup-email").value.trim();
        var content = document.getElementById("aneh-followup-content").value.trim();
        var msgEl = document.getElementById("aneh-followup-msg");
        var btn = document.getElementById("aneh-followup-btn");

        if (!email || !content) {
            msgEl.style.display = "block";
            msgEl.style.background = "#fef2f2";
            msgEl.style.border = "1px solid #fca5a5";
            msgEl.style.color = "#991b1b";
            msgEl.textContent = "יש למלא אימייל ותוכן השאלה";
            return;
        }

        btn.disabled = true;
        btn.textContent = "שולח...";

        fetch(ANEH_API + "/questions/" + postId + "/wp-follow-up", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({email: email, content: content})
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            msgEl.style.display = "block";
            if (data.error) {
                msgEl.style.background = "#fef2f2";
                msgEl.style.border = "1px solid #fca5a5";
                msgEl.style.color = "#991b1b";
                msgEl.textContent = data.error;
                btn.disabled = false;
                btn.textContent = "שלח שאלת המשך";
            } else {
                msgEl.style.background = "#ecfdf5";
                msgEl.style.border = "1px solid #6ee7b7";
                msgEl.style.color = "#065f46";
                msgEl.textContent = "שאלת ההמשך נשלחה בהצלחה! הרב יקבל אותה ויענה בהקדם.";
                document.getElementById("aneh-followup-form").style.display = "none";
            }
        })
        .catch(function() {
            msgEl.style.display = "block";
            msgEl.style.background = "#fef2f2";
            msgEl.style.color = "#991b1b";
            msgEl.textContent = "שגיאה בשליחה, נסה שוב";
            btn.disabled = false;
            btn.textContent = "שלח שאלת המשך";
        });
    }
    </script>';

    return $content . $html;
}, 20);

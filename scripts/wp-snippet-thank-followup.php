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

    // ── Thank Button (count shown on button) ──
    $html .= '<div id="aneh-thank-section" style="margin-bottom:20px;">';
    $thank_label = ($thank_count > 0) ? '❤️ תודה לרב (' . $thank_count . ')' : '❤️ תודה לרב';
    $html .= '<button id="aneh-thank-btn" onclick="anehThank(' . $post_id . ')" data-count="' . $thank_count . '" style="
        display:inline-flex; align-items:center; gap:8px;
        padding:12px 28px; background:#B8973A; color:#1B2B5E;
        border:none; border-radius:6px; cursor:pointer;
        font-size:16px; font-weight:700; font-family:Heebo,Arial,sans-serif;
        transition:background 0.2s;">
        ' . $thank_label . '
    </button>';
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

    // ── Donation popup modal (appears after thank) ──
    $html .= '<div id="aneh-donate-overlay" onclick="anehCloseDonate(event)" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:999999; justify-content:center; align-items:center;">';
    $html .= '<div style="position:relative; background:#fff; border-radius:12px; width:90%; max-width:500px; max-height:90vh; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.3);">';
    $html .= '<button onclick="anehCloseDonate()" style="position:absolute; top:8px; left:12px; background:none; border:none; font-size:24px; cursor:pointer; color:#666; z-index:10; line-height:1;">&times;</button>';
    $html .= '<iframe src="https://www.matara.pro/nedarimplus/online/?S=EdHK" style="width:100%; height:75vh; border:none; border-radius:0 0 12px 12px;"></iframe>';
    $html .= '</div>';
    $html .= '</div>';

    $html .= '</div>';

    // ── JavaScript ──
    $html .= '<script>
    var ANEH_API = "' . ANEH_API_URL . '";

    function anehThank(postId) {
        var btn = document.getElementById("aneh-thank-btn");
        var currentCount = parseInt(btn.getAttribute("data-count")) || 0;
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
                setTimeout(function() {
                    btn.textContent = currentCount > 0 ? "❤️ תודה לרב (" + currentCount + ")" : "❤️ תודה לרב";
                    btn.disabled = false;
                }, 3000);
            } else {
                var newCount = currentCount + 1;
                btn.setAttribute("data-count", newCount);
                btn.textContent = "❤️ תודה נשלחה! (" + newCount + ")";
                btn.style.background = "#10b981";
                btn.style.color = "white";
                document.getElementById("aneh-thank-msg").style.display = "block";
                // Show donation popup after short delay
                setTimeout(function() {
                    var overlay = document.getElementById("aneh-donate-overlay");
                    overlay.style.display = "flex";
                }, 1500);
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

    function anehCloseDonate(e) {
        if (e && e.target !== e.currentTarget && !e.target.closest("button")) return;
        document.getElementById("aneh-donate-overlay").style.display = "none";
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

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
 *
 * Uses wp_footer hook (works with Elementor and any page builder).
 */

// API base URL for the aneh-hashoel backend
define('ANEH_API_URL', 'https://aneh.syncup.co.il/api');

/**
 * Inject thank button + follow-up form via wp_footer
 * (Elementor does not trigger the_content filter, so we use wp_footer instead)
 */
add_action('wp_footer', function() {
    if (!is_singular('ask-rabai')) return;

    global $post;
    $answer = get_post_meta($post->ID, 'ask-answ', true);
    if (empty($answer)) return; // No answer yet

    $post_id = $post->ID;
    $thank_count = (int) get_post_meta($post->ID, 'thank_count', true);
    $follow_up_count = (int) get_post_meta($post->ID, 'follow_up_count', true);
    ?>
    <div id="aneh-actions" style="display:none; margin:30px auto; padding:20px; max-width:800px; background:#f8f6f1; border-radius:8px; border:1px solid #e0d8c8; direction:rtl; text-align:right; font-family:Heebo,Arial,sans-serif;">

        <!-- Thank Button -->
        <div id="aneh-thank-section" style="margin-bottom:20px;">
            <button id="aneh-thank-btn" data-count="<?php echo $thank_count; ?>" style="
                display:inline-flex; align-items:center; gap:8px;
                padding:12px 28px; background:#B8973A; color:#1B2B5E;
                border:none; border-radius:6px; cursor:pointer;
                font-size:16px; font-weight:700; font-family:Heebo,Arial,sans-serif;
                transition:background 0.2s;">
                <?php echo ($thank_count > 0) ? '❤️ תודה לרב (' . $thank_count . ')' : '❤️ תודה לרב'; ?>
            </button>
            <div id="aneh-thank-msg" style="display:none; margin-top:8px; padding:10px 16px; background:#ecfdf5; border:1px solid #6ee7b7; border-radius:6px; color:#065f46; font-size:14px;">
                תודה רבה! הרב יקבל את הודעתך.
            </div>
        </div>

        <?php if ($follow_up_count < 1): ?>
        <!-- Follow-up Form -->
        <div id="aneh-followup-section" style="border-top:1px solid #e0d8c8; padding-top:16px;">
            <h4 style="margin:0 0 10px; color:#1B2B5E; font-size:16px;">שאלת המשך</h4>
            <p style="margin:0 0 10px; color:#666; font-size:13px;">ניתן לשלוח שאלת הבהרה אחת בלבד.</p>
            <div id="aneh-followup-form">
                <input type="email" id="aneh-followup-email" placeholder="האימייל שלך (כפי ששלחת את השאלה)" style="
                    width:100%; padding:10px 14px; margin-bottom:8px; border:1px solid #ccc; border-radius:6px;
                    font-size:14px; font-family:Heebo,Arial,sans-serif; direction:rtl; box-sizing:border-box;" />
                <textarea id="aneh-followup-content" placeholder="כתוב את שאלת ההמשך שלך..." rows="3" style="
                    width:100%; padding:10px 14px; margin-bottom:8px; border:1px solid #ccc; border-radius:6px;
                    font-size:14px; font-family:Heebo,Arial,sans-serif; direction:rtl; resize:vertical; box-sizing:border-box;"></textarea>
                <button id="aneh-followup-btn" style="
                    padding:10px 24px; background:#1B2B5E; color:white;
                    border:none; border-radius:6px; cursor:pointer;
                    font-size:14px; font-weight:600; font-family:Heebo,Arial,sans-serif;">
                    שלח שאלת המשך
                </button>
                <div id="aneh-followup-msg" style="display:none; margin-top:8px; padding:10px 16px; border-radius:6px; font-size:14px;"></div>
            </div>
        </div>
        <?php else: ?>
        <p style="border-top:1px solid #e0d8c8; padding-top:12px; color:#999; font-size:13px;">שאלת המשך כבר נשלחה לשאלה זו.</p>
        <?php endif; ?>

        <!-- Donation popup modal (appears after thank) -->
        <div id="aneh-donate-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:999999; justify-content:center; align-items:center;">
            <div style="position:relative; background:#fff; border-radius:12px; width:90%; max-width:500px; max-height:90vh; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.3);">
                <button onclick="anehCloseDonate()" style="position:absolute; top:8px; left:12px; background:none; border:none; font-size:24px; cursor:pointer; color:#666; z-index:10; line-height:1;">&times;</button>
                <iframe src="https://www.matara.pro/nedarimplus/online/?S=EdHK" style="width:100%; height:75vh; border:none; border-radius:0 0 12px 12px;"></iframe>
            </div>
        </div>
    </div>

    <script>
    (function() {
        var ANEH_API = "<?php echo ANEH_API_URL; ?>";
        var POST_ID = <?php echo $post_id; ?>;
        var actionsEl = document.getElementById("aneh-actions");

        // Insert the actions block after the main content area
        // Try multiple selectors to find the right insertion point (works with Elementor and standard themes)
        var targets = [
            '.elementor-widget-theme-post-content',
            '.elementor-location-single .elementor-section:last-of-type',
            '.entry-content',
            '.post-content',
            'article.ask-rabai',
            '.elementor-location-single'
        ];
        var inserted = false;
        for (var i = 0; i < targets.length; i++) {
            var target = document.querySelector(targets[i]);
            if (target) {
                target.parentNode.insertBefore(actionsEl, target.nextSibling);
                inserted = true;
                break;
            }
        }
        // Fallback: append to body (still visible)
        if (!inserted) {
            document.body.appendChild(actionsEl);
        }

        actionsEl.style.display = "block";

        // ── Thank Button ──
        var thankBtn = document.getElementById("aneh-thank-btn");
        if (thankBtn) {
            thankBtn.addEventListener("click", function() {
                var currentCount = parseInt(thankBtn.getAttribute("data-count")) || 0;
                thankBtn.disabled = true;
                thankBtn.textContent = "שולח...";

                // Get or create visitor ID
                var visitorId = localStorage.getItem("aneh_visitor_id");
                if (!visitorId) {
                    visitorId = Math.random().toString(36).slice(2);
                    localStorage.setItem("aneh_visitor_id", visitorId);
                }

                fetch(ANEH_API + "/questions/" + POST_ID + "/wp-thank", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({visitor_id: visitorId})
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) {
                        thankBtn.textContent = data.error;
                        setTimeout(function() {
                            thankBtn.textContent = currentCount > 0 ? "❤️ תודה לרב (" + currentCount + ")" : "❤️ תודה לרב";
                            thankBtn.disabled = false;
                        }, 3000);
                    } else {
                        var newCount = data.thankCount || (currentCount + 1);
                        thankBtn.setAttribute("data-count", newCount);
                        thankBtn.textContent = "❤️ תודה נשלחה! (" + newCount + ")";
                        thankBtn.style.background = "#10b981";
                        thankBtn.style.color = "white";
                        document.getElementById("aneh-thank-msg").style.display = "block";
                        // Show donation popup after short delay
                        setTimeout(function() {
                            var overlay = document.getElementById("aneh-donate-overlay");
                            overlay.style.display = "flex";
                        }, 1500);
                    }
                })
                .catch(function() {
                    thankBtn.textContent = "שגיאה, נסה שוב";
                    setTimeout(function() {
                        thankBtn.disabled = false;
                        thankBtn.textContent = currentCount > 0 ? "❤️ תודה לרב (" + currentCount + ")" : "❤️ תודה לרב";
                    }, 3000);
                });
            });
        }

        // ── Donation popup close ──
        window.anehCloseDonate = function(e) {
            if (e && e.target !== e.currentTarget && !e.target.closest("button")) return;
            document.getElementById("aneh-donate-overlay").style.display = "none";
        };
        var overlay = document.getElementById("aneh-donate-overlay");
        if (overlay) overlay.addEventListener("click", window.anehCloseDonate);

        // ── Follow-up Form ──
        var followUpBtn = document.getElementById("aneh-followup-btn");
        if (followUpBtn) {
            followUpBtn.addEventListener("click", function() {
                var email = document.getElementById("aneh-followup-email").value.trim();
                var content = document.getElementById("aneh-followup-content").value.trim();
                var msgEl = document.getElementById("aneh-followup-msg");

                if (!email || !content) {
                    msgEl.style.display = "block";
                    msgEl.style.background = "#fef2f2";
                    msgEl.style.border = "1px solid #fca5a5";
                    msgEl.style.color = "#991b1b";
                    msgEl.textContent = "יש למלא אימייל ותוכן השאלה";
                    return;
                }

                followUpBtn.disabled = true;
                followUpBtn.textContent = "שולח...";

                fetch(ANEH_API + "/questions/" + POST_ID + "/wp-follow-up", {
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
                        followUpBtn.disabled = false;
                        followUpBtn.textContent = "שלח שאלת המשך";
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
                    followUpBtn.disabled = false;
                    followUpBtn.textContent = "שלח שאלת המשך";
                });
            });
        }
    })();
    </script>
    <?php
}, 50);

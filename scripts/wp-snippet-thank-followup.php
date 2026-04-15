<?php
/**
 * WP Snippet: Thank Button + Follow-up Form for ask-rabai posts
 * Injected into the answer container (data-id="425ccb7") via wp_footer.
 */

define('ANEH_API_URL', 'https://ask.moreshet-maran.com/api');

// Register thank_count meta so it's writable via WP REST API
add_action('init', function() {
    register_post_meta('ask-rabai', 'thank_count', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
    ]);
});

add_action('wp_footer', function() {
    if (!is_singular('ask-rabai')) return;

    global $post;
    $answer = get_post_meta($post->ID, 'ask-answ', true);
    if (empty($answer)) return;

    $post_id       = $post->ID;
    $thank_count   = (int) get_post_meta($post->ID, 'thank_count', true) ?: (int) get_post_meta($post->ID, 'ask_thank_count', true);
    $followup_done = (int) get_post_meta($post->ID, 'follow_up_count', true) >= 1;
    ?>

    <!-- ── ANEH Thank + Follow-up ── -->
    <div id="aneh-actions" style="display:none;">

        <div style="border-top: 1px solid #e5e0d8; margin-top: 24px; padding-top: 20px; direction: rtl; text-align: right;">

            <!-- Thank Button -->
            <button id="aneh-thank-btn" data-count="<?php echo $thank_count; ?>"
                style="display:inline-flex; align-items:center; gap:8px; cursor:pointer;
                       padding:10px 24px; border:none; border-radius:4px;
                       background:#B8973A; color:#fff;
                       font-size:15px; font-weight:700; font-family:inherit;
                       transition:opacity .15s;">
                ❤️ <?php echo $thank_count > 0 ? "תודה לרב ({$thank_count})" : 'תודה לרב'; ?>
            </button>

            <div id="aneh-thank-ok" style="display:none; margin-top:10px; padding:8px 14px;
                 background:#f0fdf4; border:1px solid #86efac; border-radius:4px;
                 color:#166534; font-size:14px; font-family:inherit;">
                תודה רבה! הרב יקבל את הודעתך.
            </div>
        </div>

        <?php if (!$followup_done): ?>
        <!-- Follow-up Form -->
        <div style="border-top:1px solid #e5e0d8; margin-top:20px; padding-top:18px; direction:rtl; text-align:right;">
            <h4 style="margin:0 0 4px; font-size:15px; font-weight:700; color:inherit; font-family:inherit;">שאלת המשך</h4>
            <p style="margin:0 0 6px; font-size:13px; color:#888; font-family:inherit;">ניתן לשלוח שאלת הבהרה אחת בלבד.</p>
            <p style="margin:0 0 12px; font-size:12px; color:#B8973A; font-family:inherit; font-weight:600;">
                * רק מי ששלח את השאלה המקורית יכול לשלוח שאלת המשך (יש להזין את אותו אימייל)
            </p>

            <div id="aneh-followup-form">
                <input type="email" id="aneh-fu-email" placeholder="האימייל שלך (כפי ששלחת את השאלה)"
                    style="width:100%; padding:9px 12px; margin-bottom:8px; box-sizing:border-box;
                           border:1px solid #ccc; border-radius:4px; font-size:14px;
                           font-family:inherit; direction:ltr; text-align:left; outline:none;" />
                <textarea id="aneh-fu-content" rows="3" placeholder="כתוב את שאלת ההמשך שלך..."
                    style="width:100%; padding:9px 12px; margin-bottom:10px; box-sizing:border-box;
                           border:1px solid #ccc; border-radius:4px; font-size:14px;
                           font-family:inherit; direction:rtl; resize:vertical; outline:none;"></textarea>
                <button id="aneh-fu-btn"
                    style="padding:9px 22px; border:none; border-radius:4px; cursor:pointer;
                           background:#1B2B5E; color:#fff; font-size:14px;
                           font-weight:600; font-family:inherit;">
                    שלח שאלת המשך
                </button>
                <div id="aneh-fu-msg" style="display:none; margin-top:10px; padding:8px 14px;
                     border-radius:4px; font-size:14px; font-family:inherit;"></div>
            </div>
        </div>
        <?php else: ?>
        <div style="border-top:1px solid #e5e0d8; margin-top:20px; padding-top:12px; direction:rtl; text-align:right;">
            <p style="margin:0; padding:8px 14px; background:#f0f7f0; border:1px solid #c3e6c3; border-radius:4px;
                      color:#2d6a2d; font-size:13px; font-family:inherit;">
                ✅ שאלת המשך כבר נשלחה לשאלה זו. הרב יענה בהקדם.
            </p>
        </div>
        <?php endif; ?>
    </div>

    <!-- Donation popup -->
    <div id="aneh-donate-overlay" style="display:none; position:fixed; inset:0;
         background:rgba(0,0,0,.55); z-index:999999; justify-content:center; align-items:center;">
        <div style="position:relative; background:#fff; border-radius:10px;
                    width:90%; max-width:480px; max-height:90vh; overflow:hidden;
                    box-shadow:0 8px 32px rgba(0,0,0,.3);">
            <button id="aneh-donate-close"
                style="position:absolute; top:6px; left:10px; background:none; border:none;
                       font-size:22px; cursor:pointer; color:#555; line-height:1;">&times;</button>
            <iframe src="https://www.matara.pro/nedarimplus/online/?S=EdHK"
                style="width:100%; height:72vh; border:none;"></iframe>
        </div>
    </div>

    <script>
    (function() {
        var API    = "<?php echo ANEH_API_URL; ?>";
        var PID    = <?php echo (int)$post_id; ?>;
        var el     = document.getElementById("aneh-actions");

        // ── Insertion: inside the answer e-con (data-id="425ccb7") ──
        // Find it by data-id; fall back to last e-con inside elementor-location-single
        var target = document.querySelector('[data-id="425ccb7"] > .e-con-inner');
        if (!target) {
            // fallback: last e-con-inner inside single template
            var all = document.querySelectorAll('.elementor-location-single .e-con-inner');
            target = all.length ? all[all.length - 1] : null;
        }
        if (target) {
            target.appendChild(el);
        } else {
            document.body.appendChild(el);
        }
        el.style.display = "block";

        // ── Thank ──
        var btn = document.getElementById("aneh-thank-btn");
        btn && btn.addEventListener("click", function() {
            var cnt = parseInt(btn.dataset.count) || 0;
            btn.disabled = true;
            btn.style.opacity = ".6";
            var vid = localStorage.getItem("aneh_vid") || (localStorage.setItem("aneh_vid", Math.random().toString(36).slice(2)), localStorage.getItem("aneh_vid"));

            fetch(API + "/questions/" + PID + "/wp-thank", {
                method: "POST",
                headers: {"Content-Type":"application/json"},
                body: JSON.stringify({visitor_id: vid})
            })
            .then(function(r){ return r.json(); })
            .then(function(d) {
                if (d.alreadyThanked) {
                    var n = d.thankCount || cnt;
                    btn.textContent = "❤️ כבר הודית (" + n + ")";
                    btn.style.background = "#6b7280";
                    btn.style.opacity = "1";
                    btn.disabled = false;
                } else if (!d.error) {
                    var n = d.thankCount || cnt + 1;
                    btn.dataset.count = n;
                    btn.textContent = "❤️ תודה נשלחה! (" + n + ")";
                    btn.style.background = "#16a34a";
                    btn.style.opacity = "1";
                    document.getElementById("aneh-thank-ok").style.display = "block";
                    setTimeout(function(){
                        var ov = document.getElementById("aneh-donate-overlay");
                        ov.style.display = "flex";
                    }, 1200);
                } else {
                    btn.textContent = d.error || "שגיאה";
                    btn.style.opacity = "1";
                    setTimeout(function(){ btn.disabled=false; btn.textContent = cnt>0?"❤️ תודה לרב ("+cnt+")":"❤️ תודה לרב"; }, 3000);
                }
            })
            .catch(function(){ btn.disabled=false; btn.style.opacity="1"; btn.textContent="שגיאה, נסה שוב"; });
        });

        // ── Donate overlay close ──
        var ov = document.getElementById("aneh-donate-overlay");
        var cls = document.getElementById("aneh-donate-close");
        cls && cls.addEventListener("click", function(){ ov.style.display="none"; });
        ov && ov.addEventListener("click", function(e){ if(e.target===ov) ov.style.display="none"; });

        // ── Follow-up ──
        var fuBtn = document.getElementById("aneh-fu-btn");
        fuBtn && fuBtn.addEventListener("click", function() {
            var email   = (document.getElementById("aneh-fu-email").value || "").trim();
            var content = (document.getElementById("aneh-fu-content").value || "").trim();
            var msg     = document.getElementById("aneh-fu-msg");

            function showMsg(text, ok) {
                msg.style.display = "block";
                msg.style.background = ok ? "#f0fdf4" : "#fef2f2";
                msg.style.border = "1px solid " + (ok ? "#86efac" : "#fca5a5");
                msg.style.color  = ok ? "#166534" : "#991b1b";
                msg.textContent  = text;
            }

            if (!email || !content) { showMsg("יש למלא אימייל ותוכן השאלה", false); return; }

            fuBtn.disabled = true;
            fuBtn.textContent = "שולח...";

            fetch(API + "/questions/" + PID + "/wp-follow-up", {
                method: "POST",
                headers: {"Content-Type":"application/json"},
                body: JSON.stringify({email: email, content: content})
            })
            .then(function(r){ return r.json(); })
            .then(function(d) {
                if (d.error) {
                    showMsg(d.error, false);
                    fuBtn.disabled = false;
                    fuBtn.textContent = "שלח שאלת המשך";
                } else {
                    showMsg("שאלת ההמשך נשלחה בהצלחה! הרב יקבל אותה ויענה בהקדם.", true);
                    document.getElementById("aneh-followup-form").style.display = "none";
                }
            })
            .catch(function(){
                showMsg("שגיאה בשליחה, נסה שוב", false);
                fuBtn.disabled = false;
                fuBtn.textContent = "שלח שאלת המשך";
            });
        });
    })();
    </script>
    <?php
}, 50);

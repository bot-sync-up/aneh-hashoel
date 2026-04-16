<?php
/**
 * WP Snippet: Thank Button + Follow-up Form for ask-rabai posts
 * Injected into the answer container (data-id="425ccb7") via wp_footer.
 */

define('ANEH_API_URL', 'https://ask.moreshet-maran.com/api');

// Register meta fields so they're writable via WP REST API
add_action('init', function() {
    register_post_meta('ask-rabai', 'thank_count', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'auth_callback' => '__return_true',
    ]);
    register_post_meta('ask-rabai', 'follow_up_count', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'auth_callback' => '__return_true',
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
                           font-family:inherit; direction:ltr; text-align:right; outline:none;" />
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
                ✅ שאלת המשך כבר נשלחה לשאלה זו.
            </p>
        </div>
        <?php endif; ?>
    </div>

    <!-- ── "תודה נשלחה" confirmation popup (opens BEFORE donation popup) ── -->
    <div id="aneh-thanks-overlay" style="display:none; position:fixed; inset:0;
         background:rgba(0,0,0,.55); z-index:999999; justify-content:center; align-items:center;
         direction:rtl; font-family:inherit;">
        <div style="position:relative; background:#fff; border-radius:14px;
                    width:92%; max-width:440px; box-shadow:0 12px 40px rgba(0,0,0,.35);
                    overflow:hidden; animation:anehFadeIn .25s ease-out;">

            <!-- Close (X) -->
            <button id="aneh-thanks-close"
                style="position:absolute; top:10px; left:14px; background:none; border:none;
                       font-size:24px; cursor:pointer; color:#888; line-height:1; padding:4px;"
                aria-label="סגור">&times;</button>

            <!-- Header with brand gradient -->
            <div style="background:linear-gradient(135deg, #1B2B5E 0%, #2a3f7a 100%);
                        padding:28px 20px 22px; text-align:center;">
                <div style="font-size:44px; margin-bottom:8px; line-height:1;">❤️</div>
                <h3 style="margin:0; color:#B8973A; font-size:22px; font-weight:700;
                           font-family:inherit; letter-spacing:.3px;">
                    תודתך נשלחה לרב!
                </h3>
                <p style="margin:6px 0 0; color:#fff; font-size:14px; font-family:inherit; opacity:.9;">
                    הרב יקבל את הודעת התודה שלך
                </p>
            </div>

            <!-- Body — donation request -->
            <div style="padding:22px 24px 20px; text-align:right;">
                <p style="margin:0 0 12px; font-size:15px; color:#333; line-height:1.6; font-family:inherit;">
                    אם עזרנו לך ורצית להחזיר טובה —
                </p>
                <p style="margin:0 0 18px; font-size:15px; color:#333; line-height:1.6; font-family:inherit;">
                    <strong style="color:#1B2B5E;">תרומה קטנה</strong> מאפשרת לנו להמשיך
                    להעביר תורה ולענות על שאלות של עוד יהודים.
                </p>

                <!-- Buttons -->
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button id="aneh-thanks-donate"
                        style="flex:1; min-width:140px; padding:13px 20px; border:none; border-radius:6px;
                               background:#B8973A; color:#1B2B5E; font-size:15px; font-weight:700;
                               cursor:pointer; font-family:inherit; transition:background .15s;">
                        💛 כן, אשמח לתרום
                    </button>
                    <button id="aneh-thanks-later"
                        style="flex:1; min-width:140px; padding:13px 20px; border:1px solid #d0d0d0;
                               border-radius:6px; background:#fff; color:#555; font-size:14px;
                               font-weight:600; cursor:pointer; font-family:inherit;">
                        אולי בהמשך
                    </button>
                </div>
            </div>

            <!-- Small footer link -->
            <div style="background:#f7f6f1; padding:10px 20px; text-align:center;
                        border-top:1px solid #ece8dd;">
                <a href="https://moreshet-maran.com" target="_blank"
                   style="color:#888; font-size:11px; text-decoration:none; font-family:inherit;">
                    המרכז למורשת מרן
                </a>
            </div>
        </div>
    </div>

    <!-- Simple fade-in keyframes -->
    <style>
        @keyframes anehFadeIn {
            from { opacity:0; transform:translateY(-8px); }
            to   { opacity:1; transform:translateY(0); }
        }
    </style>

    <!-- Donation popup (Nedarim Plus — opens only after user clicks "כן, אשמח לתרום") -->
    <!-- We embed "q:<post_id>" in the Comments field so our webhook/sync
         can correlate each donation to the specific question/rabbi being thanked. -->
    <div id="aneh-donate-overlay" style="display:none; position:fixed; inset:0;
         background:rgba(0,0,0,.55); z-index:999999; justify-content:center; align-items:center;">
        <div style="position:relative; background:#fff; border-radius:10px;
                    width:90%; max-width:480px; max-height:90vh; overflow:hidden;
                    box-shadow:0 8px 32px rgba(0,0,0,.3);">
            <button id="aneh-donate-close"
                style="position:absolute; top:6px; left:10px; background:none; border:none;
                       font-size:22px; cursor:pointer; color:#555; line-height:1;">&times;</button>
            <iframe id="aneh-donate-iframe"
                src="https://www.matara.pro/nedarimplus/online/?S=EdHK&Comments=<?php echo urlencode('q:' . $post_id); ?>"
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
                    // First show the "thanks sent" confirmation popup; user decides whether to donate
                    setTimeout(function(){
                        var thanksOv = document.getElementById("aneh-thanks-overlay");
                        if (thanksOv) thanksOv.style.display = "flex";
                    }, 700);
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

        // ── "Thanks sent" overlay: 3 ways to close + one button to open donation ──
        var thanksOv    = document.getElementById("aneh-thanks-overlay");
        var thanksClose = document.getElementById("aneh-thanks-close");
        var thanksLater = document.getElementById("aneh-thanks-later");
        var thanksDonate= document.getElementById("aneh-thanks-donate");

        function closeThanks() { if (thanksOv) thanksOv.style.display = "none"; }

        thanksClose && thanksClose.addEventListener("click", closeThanks);
        thanksLater && thanksLater.addEventListener("click", closeThanks);
        thanksOv    && thanksOv.addEventListener("click", function(e){
            if (e.target === thanksOv) closeThanks();
        });

        // "אשמח לתרום" → close thanks popup, open Nedarim popup
        thanksDonate && thanksDonate.addEventListener("click", function() {
            closeThanks();
            setTimeout(function(){
                if (ov) ov.style.display = "flex";
            }, 220); // small gap for smoother transition
        });

        // Hover effect on primary donate button
        thanksDonate && thanksDonate.addEventListener("mouseenter", function(){
            thanksDonate.style.background = "#a2832f";
        });
        thanksDonate && thanksDonate.addEventListener("mouseleave", function(){
            thanksDonate.style.background = "#B8973A";
        });

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

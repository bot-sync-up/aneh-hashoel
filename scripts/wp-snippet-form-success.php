/**
 * WP Snippet: Success animation after ask-rabai form submission
 * Shows a green checkmark animation with a success message
 * when the JetEngine form is successfully submitted.
 */

add_action('wp_footer', function() {
    // Only on pages with ask-rabai form
    if (!is_singular() && !is_page()) return;
    ?>
    <style>
    /* Success overlay */
    #aneh-success-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 999999;
        justify-content: center;
        align-items: center;
        direction: rtl;
    }
    #aneh-success-overlay.show {
        display: flex;
    }
    #aneh-success-box {
        background: #fff;
        border-radius: 16px;
        padding: 40px 50px;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        animation: aneh-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        max-width: 90%;
        width: 400px;
    }
    @keyframes aneh-pop {
        0% { transform: scale(0.5); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
    }

    /* Checkmark animation */
    .aneh-checkmark {
        width: 80px;
        height: 80px;
        margin: 0 auto 20px;
        border-radius: 50%;
        display: block;
        stroke-width: 3;
        stroke: #4CAF50;
        stroke-miterlimit: 10;
        animation: aneh-fill 0.4s ease-in-out 0.4s forwards, aneh-scale 0.3s ease-in-out 0.9s both;
        position: relative;
    }
    .aneh-checkmark__circle {
        stroke-dasharray: 166;
        stroke-dashoffset: 166;
        stroke-width: 3;
        stroke-miterlimit: 10;
        stroke: #4CAF50;
        fill: none;
        animation: aneh-stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
    }
    .aneh-checkmark__check {
        transform-origin: 50% 50%;
        stroke-dasharray: 48;
        stroke-dashoffset: 48;
        animation: aneh-stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards;
    }
    @keyframes aneh-stroke {
        100% { stroke-dashoffset: 0; }
    }
    @keyframes aneh-scale {
        0%, 100% { transform: none; }
        50% { transform: scale3d(1.1, 1.1, 1); }
    }
    @keyframes aneh-fill {
        100% { box-shadow: inset 0px 0px 0px 40px rgba(76, 175, 80, 0.1); }
    }

    #aneh-success-title {
        font-size: 22px;
        font-weight: 700;
        color: #1B2B5E;
        margin: 0 0 10px;
        font-family: inherit;
    }
    #aneh-success-msg {
        font-size: 15px;
        color: #666;
        margin: 0 0 20px;
        line-height: 1.6;
        font-family: inherit;
    }
    #aneh-success-btn {
        display: inline-block;
        padding: 10px 30px;
        background: #1B2B5E;
        color: #fff;
        border: none;
        border-radius: 8px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.2s;
    }
    #aneh-success-btn:hover {
        background: #2a3d7a;
    }
    </style>

    <!-- Success overlay HTML -->
    <div id="aneh-success-overlay">
        <div id="aneh-success-box">
            <svg class="aneh-checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                <circle class="aneh-checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
                <path class="aneh-checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
            <h3 id="aneh-success-title">שאלתך נשלחה בהצלחה!</h3>
            <p id="aneh-success-msg">
                תודה על פנייתך. השאלה התקבלה במערכת<br>
                ותועבר לרבנים בהקדם.<br>
                נשלח לך מייל כשתתקבל תשובה.
            </p>
            <button id="aneh-success-btn" onclick="document.getElementById('aneh-success-overlay').classList.remove('show');">
                סגור
            </button>
        </div>
    </div>

    <script>
    (function() {
        // Watch for JetEngine/JetFormBuilder success message
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                m.addedNodes.forEach(function(node) {
                    if (!node.classList) return;
                    // JetFormBuilder success: .jet-form-builder-message--success
                    // JetEngine success: .jet-engine-booking-success, .jet-form-message--success
                    if (
                        node.classList.contains('jet-form-builder-message--success') ||
                        node.classList.contains('jet-engine-booking-success') ||
                        node.classList.contains('jet-form-message--success')
                    ) {
                        // Hide the default success message
                        node.style.display = 'none';
                        // Show our custom animation
                        document.getElementById('aneh-success-overlay').classList.add('show');
                    }
                });
            });
        });

        // Also listen for success class on existing elements
        var checkExisting = setInterval(function() {
            var el = document.querySelector('.jet-form-builder-message--success, .jet-engine-booking-success, .jet-form-message--success');
            if (el && el.offsetParent !== null) {
                el.style.display = 'none';
                document.getElementById('aneh-success-overlay').classList.add('show');
                clearInterval(checkExisting);
            }
        }, 500);

        // Stop checking after 60 seconds
        setTimeout(function() { clearInterval(checkExisting); }, 60000);

        observer.observe(document.body, { childList: true, subtree: true });

        // Close on overlay click
        document.getElementById('aneh-success-overlay').addEventListener('click', function(e) {
            if (e.target === this) this.classList.remove('show');
        });
    })();
    </script>
    <?php
}, 99);

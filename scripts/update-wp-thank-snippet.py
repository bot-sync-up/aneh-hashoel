import requests, base64

wp_key = 'mad:LyDu qf3n zFdr lSrt eipW My7j'
cred = base64.b64encode(wp_key.encode()).decode()
headers = {'Authorization': f'Basic {cred}', 'Content-Type': 'application/json'}

new_code = r"""
add_action('wp_footer', function() {
    if (get_post_type() !== 'ask-rabai') return;
    global $post;
    if (!$post) return;
    $answer = get_post_meta($post->ID, 'ask-answ', true);
    if (empty($answer)) return;
    $pid = $post->ID;
    $tc = (int) get_post_meta($post->ID, 'thank_count', true);
    $fc = (int) get_post_meta($post->ID, 'follow_up_count', true);
?>
<script>
(function() {
    var API = 'https://aneh.syncup.co.il/api';
    var PID = <?php echo $pid; ?>;
    var TC = <?php echo $tc; ?>;
    var SHOW_FU = <?php echo ($fc < 1) ? 'true' : 'false'; ?>;
    var done = false;

    function go() {
        if (done) return;
        var nav = document.querySelector('.elementor-widget-post-navigation');
        if (!nav) nav = document.querySelector('[data-widget_type="post-navigation.default"]');
        var target = nav ? nav.closest('.elementor-element.elementor-widget') || nav : null;
        if (!target) return;
        done = true;

        var d = document.createElement('div');
        d.style.cssText = 'max-width:800px;margin:20px auto 30px;padding:24px;background:#f8f6f1;border-radius:12px;border:1px solid #e0d8c8;direction:rtl;text-align:right;font-family:Heebo,Arial,sans-serif;';

        var h = '<div style="margin-bottom:16px;">'
            + '<button id="athx" style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;background:#B8973A;color:#1B2B5E;border:none;border-radius:6px;cursor:pointer;font-size:16px;font-weight:700;font-family:Heebo,Arial,sans-serif;">\u2764\ufe0f \u05ea\u05d5\u05d3\u05d4 \u05dc\u05e8\u05d1</button>'
            + '<span id="atc" style="margin-right:12px;color:#666;font-size:14px;">' + (TC > 0 ? TC + ' \u05d4\u05d5\u05d3\u05d5' : '') + '</span>'
            + '<div id="atmsg" style="display:none;margin-top:8px;padding:10px 16px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;color:#065f46;font-size:14px;">\u05ea\u05d5\u05d3\u05d4 \u05e8\u05d1\u05d4! \u05d4\u05e8\u05d1 \u05d9\u05e7\u05d1\u05dc \u05d0\u05ea \u05d4\u05d5\u05d3\u05e2\u05ea\u05da.</div>'
            + '</div>';

        if (SHOW_FU) {
            h += '<div style="border-top:1px solid #e0d8c8;padding-top:16px;">'
                + '<h4 style="margin:0 0 10px;color:#1B2B5E;font-size:16px;">\u05e9\u05d0\u05dc\u05ea \u05d4\u05de\u05e9\u05da</h4>'
                + '<p style="margin:0 0 10px;color:#666;font-size:13px;">\u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05dc\u05d5\u05d7 \u05e9\u05d0\u05dc\u05ea \u05d4\u05d1\u05d4\u05e8\u05d4 \u05d0\u05d7\u05ea \u05d1\u05dc\u05d1\u05d3.</p>'
                + '<div id="afuf"><input type="email" id="afue" placeholder="\u05d4\u05d0\u05d9\u05de\u05d9\u05d9\u05dc \u05e9\u05dc\u05da" style="width:100%;padding:10px 14px;margin-bottom:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;direction:rtl;box-sizing:border-box;" />'
                + '<textarea id="afut" placeholder="\u05db\u05ea\u05d5\u05d1 \u05d0\u05ea \u05e9\u05d0\u05dc\u05ea \u05d4\u05d4\u05de\u05e9\u05da..." rows="3" style="width:100%;padding:10px 14px;margin-bottom:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;direction:rtl;resize:vertical;box-sizing:border-box;"></textarea>'
                + '<button id="afub" style="padding:10px 24px;background:#1B2B5E;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">\u05e9\u05dc\u05d7 \u05e9\u05d0\u05dc\u05ea \u05d4\u05de\u05e9\u05da</button>'
                + '<div id="afum" style="display:none;margin-top:8px;padding:10px 16px;border-radius:6px;font-size:14px;"></div></div></div>';
        }

        h += '<div id="adon" style="display:none;margin-top:16px;padding:16px;background:#fffbf0;border:1px solid #e8d98a;border-radius:8px;">'
            + '<p style="margin:0 0 10px;font-size:15px;color:#1B2B5E;font-weight:700;">\u05d4\u05ea\u05e9\u05d5\u05d1\u05d4 \u05e2\u05d6\u05e8\u05d4 \u05dc\u05da?</p>'
            + '<p style="margin:0 0 12px;font-size:14px;color:#555;">\u05d4\u05e4\u05e2\u05d9\u05dc\u05d5\u05ea \u05de\u05ea\u05d0\u05e4\u05e9\u05e8\u05ea \u05d1\u05d6\u05db\u05d5\u05ea \u05ea\u05d5\u05e8\u05de\u05d9\u05dd.</p>'
            + '<a href="https://moreshet-maran.com/donate" target="_blank" style="display:inline-block;padding:12px 28px;background:#B8973A;color:#1B2B5E;text-decoration:none;border-radius:6px;font-size:15px;font-weight:700;">\u05ea\u05e8\u05de\u05d5 \u05e2\u05db\u05e9\u05d9\u05d5</a></div>';

        d.innerHTML = h;
        target.parentNode.insertBefore(d, target);

        document.getElementById('athx').onclick = function() {
            var b = this; b.disabled = true; b.textContent = '\u05e9\u05d5\u05dc\u05d7...';
            fetch(API+'/questions/'+PID+'/wp-thank',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})})
            .then(function(r){return r.json()}).then(function(){
                b.textContent = '\u2764\ufe0f \u05ea\u05d5\u05d3\u05d4 \u05e0\u05e9\u05dc\u05d7\u05d4!';
                b.style.background = '#10b981'; b.style.color = 'white';
                document.getElementById('atmsg').style.display = 'block';
                setTimeout(function(){document.getElementById('adon').style.display='block';},1500);
            }).catch(function(){b.textContent='\u05e9\u05d2\u05d9\u05d0\u05d4';b.disabled=false;});
        };

        var fb = document.getElementById('afub');
        if (fb) fb.onclick = function() {
            var e = document.getElementById('afue').value.trim();
            var t = document.getElementById('afut').value.trim();
            var m = document.getElementById('afum');
            if (!e || !t) { m.style.display='block';m.style.background='#fef2f2';m.style.color='#991b1b';m.textContent='\u05d9\u05e9 \u05dc\u05de\u05dc\u05d0 \u05d0\u05d9\u05de\u05d9\u05d9\u05dc \u05d5\u05ea\u05d5\u05db\u05df';return; }
            fb.disabled=true;fb.textContent='\u05e9\u05d5\u05dc\u05d7...';
            fetch(API+'/questions/'+PID+'/wp-follow-up',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,content:t})})
            .then(function(r){return r.json()}).then(function(d){
                m.style.display='block';
                if(d.error){m.style.background='#fef2f2';m.style.color='#991b1b';m.textContent=d.error;fb.disabled=false;fb.textContent='\u05e9\u05dc\u05d7 \u05e9\u05d0\u05dc\u05ea \u05d4\u05de\u05e9\u05da';}
                else{m.style.background='#ecfdf5';m.style.color='#065f46';m.textContent='\u05e9\u05d0\u05dc\u05ea \u05d4\u05d4\u05de\u05e9\u05da \u05e0\u05e9\u05dc\u05d7\u05d4!';document.getElementById('afuf').style.display='none';}
            }).catch(function(){m.style.display='block';m.style.color='#991b1b';m.textContent='\u05e9\u05d2\u05d9\u05d0\u05d4';fb.disabled=false;});
        };
    }

    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go);
    setTimeout(go, 1500);
    setTimeout(go, 3000);
})();
</script>
<?php
});
"""

r = requests.put(
    'https://moreshet-maran.com/wp-json/code-snippets/v1/snippets/25',
    headers=headers,
    json={'name': 'Thank Button + Follow-up', 'code': new_code.strip(), 'active': True},
    timeout=15
)
print(f'Status: {r.status_code}, Active: {r.json().get("active")}')

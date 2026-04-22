<?php
/**
 * Aneh — PWA Install (שאל את הרב)
 *
 * Turns the ask-rabai page on moreshet-maran.com into an installable
 * Progressive Web App. Injects the manifest <link>, Apple/theme meta tags,
 * a service-worker registration, and a custom RTL install button.
 *
 * Registers 3 public REST routes (no auth):
 *   GET /wp-json/aneh-pwa/v1/manifest   -> application/manifest+json
 *   GET /sw-ask-rabai.js                -> text/javascript   (via rewrite)
 *   GET /.well-known/assetlinks.json    -> application/json  (TWA stub)
 *
 * Only the ask-rabai page receives the <head>/<body> injections; the REST
 * endpoints are always reachable so the installed PWA keeps working.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* -------------------------------------------------------------------------
 *  Shared helpers
 * ---------------------------------------------------------------------- */

/**
 * True when the current request is for the ask-rabai page.
 * Checks both spellings (ask-rabai — the one used in existing code — and
 * ask-rabbi) so we're resilient to either slug.
 */
function aneh_pwa_is_ask_rabai_page() {
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = strtok( $uri, '?' );
	$path = trim( (string) $path, '/' );
	return ( $path === 'ask-rabai' || $path === 'ask-rabbi' );
}

/**
 * Build the manifest array. Icon URLs are placeholders — replace them with
 * the real WP media-library URLs after uploading icon-192.png / icon-512.png
 * (see pwa-icons/README.md).
 */
function aneh_pwa_manifest_data() {
	$icon_192 = 'https://moreshet-maran.com/wp-content/uploads/2026/04/icon-192.png';
	$icon_512 = 'https://moreshet-maran.com/wp-content/uploads/2026/04/icon-512.png';

	return array(
		'name'             => 'שאל את הרב — המרכז למורשת מרן',
		'short_name'       => 'שאל את הרב',
		'description'      => 'שאלו שאלות בהלכה וקבלו תשובות מרבני המרכז למורשת מרן.',
		'start_url'        => '/ask-rabai/',
		'scope'            => '/ask-rabai/',
		'display'          => 'standalone',
		'orientation'      => 'portrait',
		'background_color' => '#ffffff',
		'theme_color'      => '#1B2B5E',
		'lang'             => 'he',
		'dir'              => 'rtl',
		'categories'       => array( 'education', 'lifestyle', 'books' ),
		'icons'            => array(
			array(
				'src'     => $icon_192,
				'sizes'   => '192x192',
				'type'    => 'image/png',
				'purpose' => 'any',
			),
			array(
				'src'     => $icon_192,
				'sizes'   => '192x192',
				'type'    => 'image/png',
				'purpose' => 'maskable',
			),
			array(
				'src'     => $icon_512,
				'sizes'   => '512x512',
				'type'    => 'image/png',
				'purpose' => 'any',
			),
			array(
				'src'     => $icon_512,
				'sizes'   => '512x512',
				'type'    => 'image/png',
				'purpose' => 'maskable',
			),
		),
	);
}

/* -------------------------------------------------------------------------
 *  REST routes
 * ---------------------------------------------------------------------- */

add_action( 'rest_api_init', function () {

	register_rest_route( 'aneh-pwa/v1', '/manifest', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function () {
			$json = wp_json_encode(
				aneh_pwa_manifest_data(),
				JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
			);
			$response = new WP_REST_Response();
			$response->set_headers( array(
				'Content-Type'  => 'application/manifest+json; charset=utf-8',
				'Cache-Control' => 'public, max-age=300',
			) );
			$response->set_data( null );
			// Emit the raw body ourselves so Content-Type is preserved.
			header( 'Content-Type: application/manifest+json; charset=utf-8' );
			header( 'Cache-Control: public, max-age=300' );
			echo $json; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			exit;
		},
	) );

	register_rest_route( 'aneh-pwa/v1', '/sw', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => 'aneh_pwa_emit_service_worker',
	) );

	register_rest_route( 'aneh-pwa/v1', '/assetlinks', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => 'aneh_pwa_emit_assetlinks',
	) );
} );

/* -------------------------------------------------------------------------
 *  Pretty URLs: /sw-ask-rabai.js and /.well-known/assetlinks.json
 *  (root-scoped SW + standard Android TWA path)
 * ---------------------------------------------------------------------- */

add_action( 'parse_request', function ( $wp ) {
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = strtok( $uri, '?' );

	if ( $path === '/sw-ask-rabai.js' ) {
		aneh_pwa_emit_service_worker();
		exit;
	}

	if ( $path === '/.well-known/assetlinks.json' ) {
		aneh_pwa_emit_assetlinks();
		exit;
	}
} );

function aneh_pwa_emit_service_worker() {
	nocache_headers();
	header( 'Content-Type: text/javascript; charset=utf-8' );
	header( 'Service-Worker-Allowed: /' );
	header( 'Cache-Control: public, max-age=0, must-revalidate' );

	$shell_url = esc_url_raw( home_url( '/ask-rabai/' ) );
	?>
/* Aneh — Service Worker for שאל את הרב */
const CACHE_NAME = 'ask-rabai-v1';
const SHELL_URL  = <?php echo wp_json_encode( $shell_url ); ?>;
const SHELL_ASSETS = [
  SHELL_URL,
  SHELL_URL + '?pwa=1'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_ASSETS).catch(() => cache.add(SHELL_URL))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isShell =
    url.origin === self.location.origin &&
    (url.pathname === '/ask-rabai/' || url.pathname === '/ask-rabai');

  if (isShell) {
    // Cache-first for the shell
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return resp;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Network-first for everything else, fall back to cache, then shell
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (req.mode === 'navigate' && resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return resp;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match(SHELL_URL))
      )
  );
});

/* Push notifications — future-proofing for web-push */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'שאל את הרב';
  const options = {
    body: data.body || '',
    icon: data.icon || '/wp-content/uploads/2026/04/icon-192.png',
    badge: data.badge || '/wp-content/uploads/2026/04/icon-192.png',
    dir: 'rtl',
    lang: 'he',
    data: { url: data.url || SHELL_URL }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || SHELL_URL;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.indexOf('/ask-rabai') !== -1 && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
	<?php
}

function aneh_pwa_emit_assetlinks() {
	// Stub for TWA — the second agent will replace with real SHA256 fingerprints.
	header( 'Content-Type: application/json; charset=utf-8' );
	header( 'Cache-Control: public, max-age=60' );
	echo '[]';
	exit;
}

/* -------------------------------------------------------------------------
 *  Frontend injection — only on the ask-rabai page
 * ---------------------------------------------------------------------- */

add_action( 'wp_head', function () {
	if ( ! aneh_pwa_is_ask_rabai_page() ) {
		return;
	}

	$manifest_url  = esc_url( rest_url( 'aneh-pwa/v1/manifest' ) );
	$apple_icon    = esc_url( 'https://moreshet-maran.com/wp-content/uploads/2026/04/icon-192.png' );
	?>
<link rel="manifest" href="<?php echo $manifest_url; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
<meta name="theme-color" content="#1B2B5E">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="שאל את הרב">
<link rel="apple-touch-icon" href="<?php echo esc_attr( $apple_icon ); ?>">
	<?php
}, 5 );

add_action( 'wp_footer', function () {
	if ( ! aneh_pwa_is_ask_rabai_page() ) {
		return;
	}
	?>
<style id="aneh-pwa-install-style">
#aneh-pwa-install{
	position:fixed;
	bottom:20px;
	left:50%;
	transform:translateX(-50%);
	z-index:999999;
	display:none;
	align-items:center;
	gap:10px;
	background:#1B2B5E;
	color:#B8973A;
	font-family:inherit;
	font-size:16px;
	font-weight:700;
	padding:12px 20px;
	border:0;
	border-radius:999px;
	box-shadow:0 6px 20px rgba(0,0,0,.25);
	cursor:pointer;
	direction:rtl;
}
#aneh-pwa-install .aneh-pwa-label{pointer-events:none}
#aneh-pwa-install .aneh-pwa-close{
	background:rgba(184,151,58,.18);
	color:#B8973A;
	border:0;
	width:24px;height:24px;
	border-radius:50%;
	font-size:16px;
	line-height:1;
	cursor:pointer;
	display:inline-flex;
	align-items:center;
	justify-content:center;
}
@media (display-mode: standalone){#aneh-pwa-install{display:none!important}}
</style>
<button id="aneh-pwa-install" type="button" aria-label="התקן את האפליקציה" hidden>
	<span class="aneh-pwa-label">התקן את האפליקציה</span>
	<span class="aneh-pwa-close" role="button" aria-label="סגור">&times;</span>
</button>
<script>
(function(){
	if (!('serviceWorker' in navigator)) return;

	window.addEventListener('load', function(){
		navigator.serviceWorker.register('/sw-ask-rabai.js', { scope: '/ask-rabai/' })
			.catch(function(err){ console.warn('[aneh-pwa] SW register failed', err); });
	});

	var isStandalone =
		window.matchMedia('(display-mode: standalone)').matches ||
		window.navigator.standalone === true;
	if (isStandalone) return;

	var deferred = null;
	var btn      = document.getElementById('aneh-pwa-install');
	if (!btn) return;
	var closeEl  = btn.querySelector('.aneh-pwa-close');
	var DISMISS_KEY = 'aneh-pwa-dismissed';

	if (sessionStorage.getItem(DISMISS_KEY) === '1') return;

	window.addEventListener('beforeinstallprompt', function(e){
		e.preventDefault();
		deferred = e;
		btn.hidden = false;
		btn.style.display = 'inline-flex';
	});

	btn.addEventListener('click', function(ev){
		if (ev.target === closeEl) {
			sessionStorage.setItem(DISMISS_KEY, '1');
			btn.style.display = 'none';
			return;
		}
		if (!deferred) return;
		deferred.prompt();
		deferred.userChoice.then(function(){
			deferred = null;
			btn.style.display = 'none';
		});
	});

	window.addEventListener('appinstalled', function(){
		btn.style.display = 'none';
		deferred = null;
	});
})();
</script>
	<?php
}, 99 );

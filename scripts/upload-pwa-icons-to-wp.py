#!/usr/bin/env python3
"""
Upload PWA icons to the WordPress media library and update the PWA snippet
with the real URLs returned by WP.

Uses the same application-password auth as deploy-wp-onesignal-snippet.py.
After uploading, the script rewrites `wp-snippet-pwa.php` in place, replacing
every occurrence of `PWA_ICON_192_URL` / `PWA_ICON_512_URL` / etc. placeholders
(or the old 2026/04/... hard-coded URLs) with the real CDN URLs.
"""
import base64
import json
import os
import re
import sys
from pathlib import Path

import requests

WP_KEY  = os.environ.get('WP_API_KEY', 'mad:LyDu qf3n zFdr lSrt eipW My7j')
WP_BASE = 'https://moreshet-maran.com/wp-json/wp/v2'

SCRIPT_DIR   = Path(__file__).resolve().parent
ICONS_DIR    = SCRIPT_DIR / 'pwa-icons'
SNIPPET_PATH = SCRIPT_DIR / 'wp-snippet-pwa.php'

# Files to upload → name the media lib should store them under
FILES = [
    ('icon-192.png',             'PWA icon 192'),
    ('icon-512.png',             'PWA icon 512'),
    ('icon-192-maskable.png',    'PWA icon 192 maskable'),
    ('icon-512-maskable.png',    'PWA icon 512 maskable'),
    ('apple-touch-icon-180.png', 'Apple touch icon 180'),
    ('favicon-32.png',           'Favicon 32'),
    ('favicon-16.png',           'Favicon 16'),
    ('play-feature-1024x500.png','Play feature graphic'),
]

def auth_header():
    return {
        'Authorization': 'Basic ' + base64.b64encode(WP_KEY.encode()).decode(),
    }

def find_existing(filename):
    """Return an existing media URL if a file of the same name already exists."""
    r = requests.get(
        f'{WP_BASE}/media',
        headers=auth_header(),
        params={'search': filename.rsplit('.', 1)[0], 'per_page': 20},
        timeout=60,
    )
    if not r.ok:
        return None
    for item in r.json():
        source_url = item.get('source_url', '')
        if source_url.rsplit('/', 1)[-1].lower() == filename.lower():
            return source_url
    return None

def upload_file(path: Path, title: str):
    """Upload one file, returning the final source_url."""
    existing = find_existing(path.name)
    if existing:
        print(f'  ↪ already in media lib: {existing}')
        return existing

    headers = {
        **auth_header(),
        'Content-Type': 'image/png',
        'Content-Disposition': f'attachment; filename="{path.name}"',
    }
    with path.open('rb') as fh:
        data = fh.read()
    r = requests.post(f'{WP_BASE}/media', headers=headers, data=data, timeout=(15, 120))
    if not r.ok:
        raise RuntimeError(f'upload {path.name} failed: {r.status_code} {r.text[:300]}')
    body = r.json()
    media_id = body['id']
    source_url = body['source_url']

    # Patch title + alt text for admin-UI clarity (non-fatal)
    requests.post(
        f'{WP_BASE}/media/{media_id}',
        headers={**auth_header(), 'Content-Type': 'application/json'},
        json={'title': title, 'alt_text': title},
        timeout=60,
    )
    print(f'  [ok] uploaded {path.name} → {source_url}')
    return source_url

def patch_snippet(url_map: dict):
    """Replace placeholder URLs in the PHP snippet with real ones."""
    text = SNIPPET_PATH.read_text(encoding='utf-8')
    original = text

    # Canonical placeholder pattern the PWA agent left behind:
    #   wp-content/uploads/2026/04/icon-192.png
    # We match the /uploads/.../icon-XXX.png and swap to the real URL.
    for fname, url in url_map.items():
        # Anything that ends with /{fname} on moreshet-maran.com gets replaced
        pattern = re.compile(
            r'https://moreshet-maran\.com/wp-content/uploads/[^"\'\s]*' +
            re.escape(fname),
        )
        text, n = pattern.subn(url, text)
        if n:
            print(f'  ↻ snippet: replaced {n} refs → {fname}')

    if text == original:
        print('  (no placeholders replaced — snippet may already be up-to-date)')
        return False

    SNIPPET_PATH.write_text(text, encoding='utf-8')
    return True

def main():
    if not ICONS_DIR.exists():
        print(f'icons dir not found: {ICONS_DIR}', file=sys.stderr)
        sys.exit(1)

    print(f'Uploading {len(FILES)} icons to WP media library…\n')
    url_map = {}
    for fname, title in FILES:
        path = ICONS_DIR / fname
        if not path.exists():
            print(f'  ✗ missing: {path}', file=sys.stderr)
            continue
        url_map[fname] = upload_file(path, title)

    print('\nPatching snippet with real URLs…')
    changed = patch_snippet(url_map)

    print('\nURL map for reference:')
    print(json.dumps(url_map, indent=2, ensure_ascii=False))

    if changed:
        print('\n✓ wp-snippet-pwa.php updated.')
        print('  Next: run `python deploy-pwa-snippet.py` to push the updated snippet to WP.')
    else:
        print('\n(snippet unchanged — still deploy if you haven\'t yet)')

if __name__ == '__main__':
    main()

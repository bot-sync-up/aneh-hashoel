#!/usr/bin/env python3
"""
Deploy the updated wp-snippet-thank-followup.php to WordPress Code Snippets
(Snippet ID 25 on moreshet-maran.com) via the REST API.

Reads the local scripts/wp-snippet-thank-followup.php file, strips the
leading '<?php' tag (WP Code Snippets expects code without it), and PUTs
the payload.

Run:
    python scripts/deploy-wp-thank-snippet-v2.py
"""
import base64
import os
import sys
import requests

WP_KEY = os.environ.get('WP_API_KEY', 'mad:LyDu qf3n zFdr lSrt eipW My7j')
SNIPPET_ID = 25
SNIPPET_NAME = 'Thank Button + Follow-up'
SNIPPET_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'wp-snippet-thank-followup.php'
)
API_URL = f'https://moreshet-maran.com/wp-json/code-snippets/v1/snippets/{SNIPPET_ID}'


def load_snippet_code():
    with open(SNIPPET_FILE, 'r', encoding='utf-8') as fh:
        text = fh.read()
    # Strip leading <?php ... optional docblock-like prelude
    if text.startswith('<?php'):
        text = text[len('<?php'):].lstrip('\n')
    # Trim trailing ?> if present
    if text.rstrip().endswith('?>'):
        text = text.rstrip()[:-2].rstrip() + '\n'
    return text


def main():
    code = load_snippet_code()
    print(f'Loaded snippet: {len(code)} chars')

    cred = base64.b64encode(WP_KEY.encode()).decode()
    headers = {
        'Authorization': f'Basic {cred}',
        'Content-Type': 'application/json',
    }

    payload = {
        'name':   SNIPPET_NAME,
        'code':   code,
        'active': True,
    }

    resp = requests.put(API_URL, headers=headers, json=payload, timeout=20)
    print(f'HTTP {resp.status_code}')
    try:
        data = resp.json()
        print('name   =', data.get('name'))
        print('active =', data.get('active'))
        print('scope  =', data.get('scope'))
        print('code length in response =', len(data.get('code', '')))
    except Exception:
        print(resp.text[:500])
        sys.exit(1)

    if not resp.ok:
        sys.exit(f'Failed: {resp.status_code} {resp.text[:300]}')
    print('✅ Snippet updated successfully.')


if __name__ == '__main__':
    main()

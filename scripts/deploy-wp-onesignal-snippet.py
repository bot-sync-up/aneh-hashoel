#!/usr/bin/env python3
"""
Deploy the OneSignal answer-trigger Code Snippet to moreshet-maran.com.

Creates the snippet if it doesn't exist yet, updates it if it does.
Identifies the existing snippet by name 'Aneh — OneSignal Answer Trigger'.
"""
import base64
import os
import sys
import requests

WP_KEY   = os.environ.get('WP_API_KEY', 'mad:LyDu qf3n zFdr lSrt eipW My7j')
WP_BASE  = 'https://moreshet-maran.com/wp-json/code-snippets/v1'
NAME     = 'Aneh — OneSignal Answer Trigger'
FILE     = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'wp-snippet-onesignal-answer.php'
)


def load_code():
    with open(FILE, 'r', encoding='utf-8') as fh:
        text = fh.read()
    if text.startswith('<?php'):
        text = text[len('<?php'):].lstrip('\n')
    if text.rstrip().endswith('?>'):
        text = text.rstrip()[:-2].rstrip() + '\n'
    return text


def main():
    code = load_code()
    headers = {
        'Authorization': 'Basic ' + base64.b64encode(WP_KEY.encode()).decode(),
        'Content-Type':  'application/json',
    }

    # Find existing snippet by name
    listing = requests.get(f'{WP_BASE}/snippets', headers=headers, timeout=60)
    listing.raise_for_status()
    snippets = listing.json()
    existing = next((s for s in snippets if s.get('name') == NAME), None)

    payload = {'name': NAME, 'code': code, 'active': True, 'scope': 'global'}

    if existing:
        sid = existing['id']
        print(f'Updating existing snippet id={sid}')
        r = requests.put(f'{WP_BASE}/snippets/{sid}', headers=headers,
                         json=payload, timeout=(15, 180))
    else:
        print('Creating new snippet')
        r = requests.post(f'{WP_BASE}/snippets', headers=headers,
                          json=payload, timeout=(15, 180))

    print(f'HTTP {r.status_code}')
    if r.ok:
        d = r.json()
        print(f"name: {d.get('name')}")
        print(f"id: {d.get('id')}")
        print(f"active: {d.get('active')}")
        print(f"scope: {d.get('scope')}")
        print(f"code length: {len(d.get('code', ''))}")
    else:
        print('Response:', r.text[:400])
        sys.exit(1)


if __name__ == '__main__':
    main()

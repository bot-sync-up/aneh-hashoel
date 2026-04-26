#!/usr/bin/env python3
"""
Publish the privacy policy as a WordPress Page on moreshet-maran.com.

Reads mobile/play-store-listing/06-privacy-policy.md, fills in the
placeholder fields (email, date, physical address), converts the
markdown to HTML, and creates / updates a WP page titled
"מדיניות פרטיות".

Outputs the final page URL — paste this into Play Console.
"""
import base64
import os
import re
import sys
from datetime import date
from pathlib import Path

import requests
import markdown

# ─── Config ──────────────────────────────────────────────────────────────────
WP_KEY    = os.environ.get('WP_API_KEY', 'mad:LyDu qf3n zFdr lSrt eipW My7j')
WP_BASE   = 'https://moreshet-maran.com/wp-json/wp/v2'

PAGE_TITLE = 'מדיניות פרטיות'
PAGE_SLUG  = 'privacy-policy'

PRIVACY_EMAIL = 'office@moreshet-maran.com'
PUBLISH_DATE  = '26 באפריל 2026'   # also used for "תאריך תוקף"

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_MD    = REPO_ROOT / 'mobile' / 'play-store-listing' / '06-privacy-policy.md'

# ─── Step 1 — fill placeholders + drop the no-address line ─────────────────
def prepare_markdown() -> str:
    md = SRC_MD.read_text(encoding='utf-8')

    # Date placeholders (two of them — top-of-doc + section 9 footer)
    md = md.replace('[PLACEHOLDER — יום, חודש, שנה]', PUBLISH_DATE)
    md = md.replace('[PLACEHOLDER — יום פרסום ראשון]', PUBLISH_DATE)

    # Email placeholders (top-of-doc + section 8)
    md = md.replace('[PLACEHOLDER — privacy@moreshet-maran.com]', PRIVACY_EMAIL)

    # Drop the "דואר רגיל" line entirely — there is no public street address
    md = re.sub(
        r'^- \*\*דואר רגיל:\*\*[^\n]*\n',
        '',
        md,
        count=1,
        flags=re.MULTILINE,
    )

    # Sanity: refuse to publish if any placeholder still remains
    if 'PLACEHOLDER' in md:
        leftovers = [ln for ln in md.splitlines() if 'PLACEHOLDER' in ln]
        sys.exit('Refusing to publish — leftover placeholders:\n  ' + '\n  '.join(leftovers))

    return md


# ─── Step 2 — markdown → HTML, RTL-friendly ────────────────────────────────
def render_html(md_text: str) -> str:
    html_body = markdown.markdown(
        md_text,
        extensions=['extra', 'sane_lists', 'tables'],
    )

    # WordPress will wrap this in its own page chrome. We just want clean
    # RTL-aware Hebrew content. Provide a single root <div dir="rtl"> so
    # browsers do RTL layout regardless of theme defaults.
    return f'<div dir="rtl" lang="he" style="text-align:right;">\n{html_body}\n</div>'


# ─── Step 3 — find / create the WP page ────────────────────────────────────
def auth_header():
    return {
        'Authorization': 'Basic ' + base64.b64encode(WP_KEY.encode()).decode(),
    }


def find_page_by_slug(slug: str):
    r = requests.get(
        f'{WP_BASE}/pages',
        headers=auth_header(),
        params={'slug': slug, 'per_page': 5, 'status': 'publish,draft,private'},
        timeout=60,
    )
    r.raise_for_status()
    items = r.json()
    return items[0] if items else None


def upsert_page(html: str) -> dict:
    payload = {
        'title':   PAGE_TITLE,
        'slug':    PAGE_SLUG,
        'content': html,
        'status':  'publish',
    }

    existing = find_page_by_slug(PAGE_SLUG)
    if existing:
        pid = existing['id']
        print(f'Updating existing page id={pid}')
        r = requests.post(
            f'{WP_BASE}/pages/{pid}',
            headers={**auth_header(), 'Content-Type': 'application/json'},
            json=payload,
            timeout=(15, 120),
        )
    else:
        print('Creating new page')
        r = requests.post(
            f'{WP_BASE}/pages',
            headers={**auth_header(), 'Content-Type': 'application/json'},
            json=payload,
            timeout=(15, 120),
        )

    if not r.ok:
        sys.exit(f'WP error {r.status_code}: {r.text[:400]}')

    return r.json()


# ─── Main ───────────────────────────────────────────────────────────────────
def main():
    md_text = prepare_markdown()
    html    = render_html(md_text)

    print(f'Source: {SRC_MD}')
    print(f'Email:  {PRIVACY_EMAIL}')
    print(f'Date:   {PUBLISH_DATE}')
    print(f'HTML:   {len(html):,} chars')
    print()

    page = upsert_page(html)

    print()
    print('=' * 60)
    print(f"  Title:  {page.get('title', {}).get('rendered', PAGE_TITLE)}")
    print(f"  Status: {page.get('status')}")
    print(f"  URL:    {page.get('link')}")
    print('=' * 60)
    print()
    print('Paste this URL into Play Console → App content → Privacy policy.')


if __name__ == '__main__':
    main()

#!/usr/bin/env node
'use strict';

/**
 * Generate PWA / TWA / Play Store icons from the question-mark glyph used
 * on moreshet-maran.com/ask-rabai/. Recolors the white silhouette into the
 * brand's gold and composites it on a navy background so the icon reads
 * clearly even at launcher-thumbnail sizes.
 *
 * Source: scripts/pwa-icons-source/questionmark.png (downloaded from WP)
 *   or: /tmp/questionmark.png
 *
 * Outputs (overwrites scripts/pwa-icons/):
 *   icon-192.png, icon-512.png                    – "any" purpose
 *   icon-192-maskable.png, icon-512-maskable.png  – ~30% padding for safe zone
 *   apple-touch-icon-180.png, favicon-32.png, favicon-16.png
 *   play-feature-1024x500.png                     – Play Store feature graphic
 *
 * Run from repo root:  node scripts/generate-questionmark-icons.js
 */

const path = require('path');
const fs   = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');
const sharp = require(path.join(REPO_ROOT, 'backend', 'node_modules', 'sharp'));

const NAVY = { r: 0x1B, g: 0x2B, b: 0x5E, alpha: 1 };
const GOLD = { r: 0xB8, g: 0x97, b: 0x3A, alpha: 1 };

const OUT_DIR = path.join(REPO_ROOT, 'scripts', 'pwa-icons');

// Try a few likely source paths
const SRC_CANDIDATES = [
  path.join(REPO_ROOT, 'scripts', 'pwa-icons-source', 'questionmark.png'),
  path.join(REPO_ROOT, 'mobile', 'android-twa', 'screenshots', 'questionmark-source.png'),
  '/tmp/questionmark.png',
];
const SRC = SRC_CANDIDATES.find((p) => fs.existsSync(p));
if (!SRC) {
  console.error('Source question-mark PNG not found. Checked:');
  SRC_CANDIDATES.forEach((p) => console.error('  -', p));
  process.exit(1);
}

/**
 * Recolor a white-on-transparent silhouette into solid gold using its alpha
 * channel as a mask, then compose centered on a navy square of `size`.
 *
 * @param {number}  size       output square size
 * @param {number}  paddingPct percentage of each edge to keep clear (0 .. 0.5)
 * @returns {Promise<Buffer>}  PNG buffer
 */
async function renderIcon(size, paddingPct = 0.15) {
  const inner = Math.round(size * (1 - paddingPct * 2));

  // Step 1: recolor the silhouette. The source PNG is a watermark —
  // alpha values top out around ~13/255 (~5%) inside the question-mark
  // shape and are 0 elsewhere. Threshold the alpha to a binary 0/255
  // mask so the icon shows the '?' as a fully opaque gold glyph.
  const srcAlpha = await sharp(SRC)
    .resize({
      width:  inner,
      height: inner,
      fit:    'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extractChannel('alpha')
    .threshold(1)               // any nonzero alpha -> 255
    .toBuffer();

  // Make a gold rectangle the same size as the resized question mark
  const goldRect = await sharp({
    create: {
      width: inner, height: inner, channels: 3,
      background: { r: GOLD.r, g: GOLD.g, b: GOLD.b },
    },
  })
    .png()
    .toBuffer();

  // Combine: gold RGB + question-mark alpha
  const goldQ = await sharp(goldRect)
    .joinChannel(srcAlpha)   // 4-channel result: gold where '?' was opaque
    .png()
    .toBuffer();

  // Step 2: compose on navy square
  return sharp({
    create: { width: size, height: size, channels: 4, background: NAVY },
  })
    .composite([{ input: goldQ, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function renderFeatureGraphic() {
  const inner = 360;
  const srcAlpha = await sharp(SRC)
    .resize({
      width:  inner,
      height: inner,
      fit:    'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extractChannel('alpha')
    .threshold(1)
    .toBuffer();

  const goldRect = await sharp({
    create: {
      width: inner, height: inner, channels: 3,
      background: { r: GOLD.r, g: GOLD.g, b: GOLD.b },
    },
  }).png().toBuffer();

  const goldQ = await sharp(goldRect).joinChannel(srcAlpha).png().toBuffer();

  return sharp({ create: { width: 1024, height: 500, channels: 4, background: NAVY } })
    .composite([{ input: goldQ, left: 70, top: 70 }])
    .png()
    .toBuffer();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Source: ${SRC}`);
  console.log(`Output: ${OUT_DIR}\n`);

  const jobs = [
    // Standard "any" icons — small padding so the '?' fills the tile
    { name: 'icon-192.png',             buf: await renderIcon(192, 0.12) },
    { name: 'icon-512.png',             buf: await renderIcon(512, 0.12) },
    // Maskable: launcher may crop up to ~10% on each side, so keep ~20% padding
    { name: 'icon-192-maskable.png',    buf: await renderIcon(192, 0.22) },
    { name: 'icon-512-maskable.png',    buf: await renderIcon(512, 0.22) },
    // iOS home screen
    { name: 'apple-touch-icon-180.png', buf: await renderIcon(180, 0.12) },
    // Browser tabs
    { name: 'favicon-32.png',           buf: await renderIcon(32,  0.10) },
    { name: 'favicon-16.png',           buf: await renderIcon(16,  0.08) },
    // Play feature graphic
    { name: 'play-feature-1024x500.png', buf: await renderFeatureGraphic() },
  ];

  for (const { name, buf } of jobs) {
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, buf);
    console.log(`  ✓ ${name.padEnd(30)} ${buf.length.toString().padStart(7)} bytes`);
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error('Icon generation failed:', e);
  process.exit(1);
});

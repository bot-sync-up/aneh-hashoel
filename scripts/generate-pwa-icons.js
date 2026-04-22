#!/usr/bin/env node
'use strict';

/**
 * One-shot: generate PWA / TWA / Play Store icons from the existing logo.
 *
 * Inputs:
 *   frontend/public/logo.png (894×484 RGBA)
 *
 * Outputs (scripts/pwa-icons/):
 *   icon-192.png, icon-512.png                   — "any" purpose
 *   icon-192-maskable.png, icon-512-maskable.png — safe-zone 20% padding, solid navy
 *   apple-touch-icon-180.png                     — iOS home screen
 *   favicon-32.png, favicon-16.png               — browser tabs
 *   play-feature-1024x500.png                    — Play Store feature graphic
 *
 * Run:
 *   cd backend && node ../scripts/generate-pwa-icons.js
 *   (must be run from a dir where sharp is installed — backend has it)
 */

const path  = require('path');
const fs    = require('fs');

// sharp ships with backend/node_modules; resolve it from there so this
// script can run from any cwd without requiring NODE_PATH
const REPO_ROOT = path.resolve(__dirname, '..');
const sharp = require(path.join(REPO_ROOT, 'backend', 'node_modules', 'sharp'));

const LOGO_SRC = path.join(REPO_ROOT, 'frontend', 'public', 'logo.png');
const OUT_DIR  = path.join(REPO_ROOT, 'scripts', 'pwa-icons');
const NAVY     = { r: 0x1B, g: 0x2B, b: 0x5E, alpha: 1 };

async function renderSquare(size, { paddingPct = 0, transparent = false } = {}) {
  const inner = Math.round(size * (1 - paddingPct * 2));
  const resized = await sharp(LOGO_SRC)
    .resize({
      width: inner,
      height: inner,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const bg = transparent
    ? { r: 0, g: 0, b: 0, alpha: 0 }
    : NAVY;

  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(LOGO_SRC)) {
    console.error('Logo not found:', LOGO_SRC);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const meta = await sharp(LOGO_SRC).metadata();
  console.log(`Source: ${meta.width}×${meta.height} ${meta.format}`);
  console.log(`Output: ${OUT_DIR}\n`);

  const jobs = [
    { name: 'icon-192.png',             buf: await renderSquare(192, { paddingPct: 0.08 }) },
    { name: 'icon-512.png',             buf: await renderSquare(512, { paddingPct: 0.08 }) },
    { name: 'icon-192-maskable.png',    buf: await renderSquare(192, { paddingPct: 0.20 }) },
    { name: 'icon-512-maskable.png',    buf: await renderSquare(512, { paddingPct: 0.20 }) },
    { name: 'apple-touch-icon-180.png', buf: await renderSquare(180, { paddingPct: 0.10 }) },
    { name: 'favicon-32.png',           buf: await renderSquare(32,  { paddingPct: 0.05 }) },
    { name: 'favicon-16.png',           buf: await renderSquare(16,  { paddingPct: 0.05 }) },
  ];

  // Play Store feature graphic — logo on left over solid navy
  const logoForFeature = await sharp(LOGO_SRC)
    .resize({ width: 380, height: 380, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const featureBuf = await sharp({
    create: { width: 1024, height: 500, channels: 4, background: NAVY },
  })
    .composite([{ input: logoForFeature, left: 60, top: 60 }])
    .png()
    .toBuffer();

  jobs.push({ name: 'play-feature-1024x500.png', buf: featureBuf });

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

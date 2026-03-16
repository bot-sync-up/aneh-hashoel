#!/usr/bin/env node
/**
 * create-admin.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates the first admin rabbi in the database.
 *
 * Usage (interactive — prompts for missing values):
 *   node src/scripts/create-admin.js
 *
 * Usage (non-interactive — all values via flags):
 *   node src/scripts/create-admin.js \
 *     --name  "הרב ישראל כהן" \
 *     --email admin@example.com \
 *     --password "SecurePass123!"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const path   = require('path');
const readline = require('readline');

// Load .env from project root (two levels up from src/scripts/)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return EMAIL_RE.test(String(email).toLowerCase());
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[++i];
    }
  }
  return args;
}

function prompt(rl, question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      // Hide password input on real terminals
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      let value = '';
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onData = (char) => {
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
        } else if (char === '\u0003') {
          // Ctrl-C
          process.stdout.write('\n');
          process.exit(1);
        } else if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(question + '*'.repeat(value.length));
          }
        } else {
          value += char;
          process.stdout.write('*');
        }
      };
      process.stdin.on('data', onData);
    } else {
      rl.question(question, resolve);
    }
  });
}

// ── Database ──────────────────────────────────────────────────────────────────

function createPool() {
  return new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME     || 'aneh_hashoel',
    user:     process.env.DB_USER     || 'aneh_user',
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    max: 1,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cliArgs = parseArgs(process.argv);

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    terminal: true,
  });

  console.log('\n──────────────────────────────────────────────');
  console.log(' ענה את השואל — Create Admin Rabbi');
  console.log('──────────────────────────────────────────────\n');

  // ── Collect inputs ──────────────────────────────────────────────────────────

  let name = cliArgs.name;
  if (!name || name.trim() === '') {
    name = await prompt(rl, 'Rabbi full name (שם מלא): ');
    name = name.trim();
  }
  if (!name) {
    console.error('Error: name is required.');
    process.exit(1);
  }

  let email = cliArgs.email;
  if (!email || !isValidEmail(email)) {
    if (email) console.warn(`  Warning: "${email}" is not a valid email address.`);
    do {
      email = (await prompt(rl, 'Email address: ')).trim().toLowerCase();
    } while (!isValidEmail(email) && console.warn('  Invalid email — try again.'));
  } else {
    email = email.toLowerCase();
  }

  let password = cliArgs.password;
  if (!password || password.length < 8) {
    if (password) console.warn('  Warning: password must be at least 8 characters.');
    do {
      password = await prompt(rl, 'Password (min 8 chars): ', { hidden: true });
    } while (password.length < 8 && console.warn('  Password too short — try again.'));
  }

  rl.close();

  // ── Hash password ───────────────────────────────────────────────────────────

  console.log('\nHashing password...');
  const SALT_ROUNDS = 12;
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // ── Connect and insert ──────────────────────────────────────────────────────

  const pool = createPool();

  try {
    console.log(`Connecting to PostgreSQL at ${process.env.DB_HOST || 'localhost'}...`);
    const client = await pool.connect();

    try {
      // Check if email already exists
      const existing = await client.query(
        'SELECT id FROM rabbis WHERE email = $1',
        [email]
      );
      if (existing.rowCount > 0) {
        console.error(`\nError: A rabbi with email "${email}" already exists.`);
        process.exit(1);
      }

      // Insert admin rabbi
      const result = await client.query(
        `INSERT INTO rabbis
           (name, email, password_hash, role, is_active, created_at, updated_at)
         VALUES
           ($1,   $2,    $3,            $4,   true,      NOW(),      NOW())
         RETURNING id, name, email, role, created_at`,
        [name, email, passwordHash, 'admin']
      );

      const rabbi = result.rows[0];

      console.log('\n──────────────────────────────────────────────');
      console.log(' Admin rabbi created successfully!');
      console.log('──────────────────────────────────────────────');
      console.log(`  ID:        ${rabbi.id}`);
      console.log(`  Name:      ${rabbi.name}`);
      console.log(`  Email:     ${rabbi.email}`);
      console.log(`  Role:      ${rabbi.role}`);
      console.log(`  Created:   ${rabbi.created_at.toISOString()}`);
      console.log('──────────────────────────────────────────────\n');
      console.log('You can now log in at the admin dashboard.\n');
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error('\nError: Cannot connect to PostgreSQL.');
      console.error('Make sure the database is running and .env is configured correctly.');
    } else if (err.code === '42P01') {
      console.error('\nError: The "rabbis" table does not exist.');
      console.error('Run migrations first:  npm run migrate');
    } else {
      console.error('\nUnexpected error:', err.message);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

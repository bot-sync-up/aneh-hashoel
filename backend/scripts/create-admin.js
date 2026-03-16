#!/usr/bin/env node
'use strict';

/**
 * create-admin.js
 *
 * Creates or updates the first admin rabbi account.
 *
 * Usage (interactive prompt):
 *   node scripts/create-admin.js
 *
 * Usage (non-interactive, all arguments via CLI):
 *   node scripts/create-admin.js --email admin@example.com \
 *                                --name "מנהל המערכת"      \
 *                                --password "s3cr3t!"
 *
 * Environment variables are loaded from .env automatically.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline = require('readline');
const bcrypt   = require('bcryptjs');
const { Pool } = require('pg');

// ─── DB pool (standalone – does not use src/db/pool.js) ──────────────────────

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'aneh_hashoel',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
});

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--email'    && argv[i + 1]) { args.email    = argv[++i]; continue; }
    if (argv[i] === '--name'     && argv[i + 1]) { args.name     = argv[++i]; continue; }
    if (argv[i] === '--password' && argv[i + 1]) { args.password = argv[++i]; continue; }
  }
  return args;
}

// ─── Readline helpers ─────────────────────────────────────────────────────────

function createRl() {
  return readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });
}

function ask(rl, question, defaultValue) {
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Prompt for a password without echoing it to the terminal.
 * Falls back to a visible prompt if the terminal does not support raw mode
 * (e.g. piped stdin in CI environments).
 */
function askPassword(rl) {
  return new Promise((resolve) => {
    process.stdout.write('Password (input hidden): ');

    // Attempt to suppress echo using readline's internal muted-stream trick
    const previousOutput = rl.output;
    rl.output = {
      write: () => {},
      end:   () => {},
    };

    rl.question('', (answer) => {
      rl.output = previousOutput;
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

// ─── Core logic ───────────────────────────────────────────────────────────────

async function upsertAdmin({ email, name, password }) {
  const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
  console.log(`\nHashing password with bcrypt (rounds=${BCRYPT_ROUNDS}) …`);
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const sql = `
    INSERT INTO rabbis (
      email,
      name,
      role,
      password_hash,
      notification_pref,
      milestone_count,
      warning_sent,
      vacation_mode,
      two_fa_enabled
    ) VALUES ($1, $2, 'admin', $3, 'all', 0, FALSE, FALSE, FALSE)
    ON CONFLICT (email) DO UPDATE
      SET name          = EXCLUDED.name,
          role          = 'admin',
          password_hash = EXCLUDED.password_hash,
          updated_at    = NOW()
    RETURNING id, email, name, role, created_at;
  `;

  const result = await pool.query(sql, [email, name, hash]);
  return result.rows[0];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cliArgs = parseArgs(process.argv);
  const isInteractive = process.stdin.isTTY;

  let email    = cliArgs.email;
  let name     = cliArgs.name;
  let password = cliArgs.password;

  // Fill in any missing fields interactively
  if (!email || !name || !password) {
    if (!isInteractive && (!email || !name || !password)) {
      console.error(
        'Non-interactive mode: please supply --email, --name, and --password.\n' +
        'Example:\n' +
        '  node scripts/create-admin.js --email admin@example.com --name "Admin" --password "s3cr3t"'
      );
      process.exitCode = 1;
      return;
    }

    console.log('\n=== Create / update admin rabbi ===\n');
    const rl = createRl();

    try {
      if (!email) {
        do {
          email = await ask(rl, 'Email', 'admin@example.com');
          if (!validateEmail(email)) console.log('  Invalid email address. Please try again.');
        } while (!validateEmail(email));
      }

      if (!name) {
        name = await ask(rl, 'Display name', 'מנהל המערכת');
        if (!name) {
          console.error('Name is required.');
          process.exitCode = 1;
          return;
        }
      }

      if (!password) {
        let validationError;
        do {
          password = await askPassword(rl);
          validationError = validatePassword(password);
          if (validationError) console.log(`  ${validationError}`);
        } while (validationError);

        const confirm = await askPassword(rl);
        if (password !== confirm) {
          console.error('\nPasswords do not match. Aborting.');
          process.exitCode = 1;
          return;
        }
      }
    } finally {
      rl.close();
    }
  }

  // Final validation when all values come from argv
  if (!validateEmail(email)) {
    console.error(`Invalid email address: "${email}"`);
    process.exitCode = 1;
    return;
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    console.error(passwordError);
    process.exitCode = 1;
    return;
  }

  if (!name) {
    console.error('Name is required.');
    process.exitCode = 1;
    return;
  }

  try {
    const admin = await upsertAdmin({ email, name, password });
    console.log('\nAdmin account ready:');
    console.log(`  ID:         ${admin.id}`);
    console.log(`  Email:      ${admin.email}`);
    console.log(`  Name:       ${admin.name}`);
    console.log(`  Role:       ${admin.role}`);
    console.log(`  Created at: ${admin.created_at}`);
    console.log('\nDone.\n');
  } catch (err) {
    if (err.code === '23505') {
      // Unique-violation on a column other than email (e.g. google_id)
      console.error('Unique constraint violation:', err.detail);
    } else {
      console.error('Database error:', err.message);
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

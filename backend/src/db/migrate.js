/**
 * Database Migration Runner  –  src/db/migrate.js
 *
 * Usage (standalone):
 *   node src/db/migrate.js            – run all pending migrations (default)
 *   node src/db/migrate.js rollback   – revert the last applied migration
 *   node src/db/migrate.js status     – print applied / pending list
 *
 * Migration files:
 *   Plain .sql files under src/db/migrations/, applied in alphabetical order.
 *   Use numeric prefixes (001_, 002_, …) to enforce a stable sequence.
 *
 *   For rollback support, each migration file may contain an optional
 *   "-- DOWN" section:
 *
 *     -- UP
 *     CREATE TABLE foo (...);
 *
 *     -- DOWN
 *     DROP TABLE IF EXISTS foo;
 *
 *   If no "-- DOWN" marker is present the rollback command exits with an error
 *   for that migration rather than silently succeeding.
 *
 * Tracking table:
 *   `migrations` – created automatically on first run.
 *
 * Environment variables:
 *   DATABASE_URL  – required; PostgreSQL connection string
 *   DB_SSL        – set to "true" to enable SSL
 *   DB_SSL_REJECT_UNAUTHORIZED – set to "false" to accept self-signed certs
 */

import 'dotenv/config';

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __filename    = fileURLToPath(import.meta.url);
const __dirname     = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ─── Database pool ────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:@localhost:5432/aneh_hashoel',
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensure the `migrations` tracking table exists.
 * Safe to call on every run (IF NOT EXISTS).
 *
 * @param {import('pg').PoolClient} client
 */
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id          SERIAL       PRIMARY KEY,
      filename    VARCHAR(255) UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Return the set of already-applied migration filenames.
 *
 * @param {import('pg').PoolClient} client
 * @returns {Promise<Set<string>>}
 */
async function getAppliedMigrations(client) {
  const { rows } = await client.query(
    'SELECT filename FROM migrations ORDER BY filename'
  );
  return new Set(rows.map((r) => r.filename));
}

/**
 * Read and sort all .sql filenames from the migrations directory.
 *
 * @returns {string[]}
 */
function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn(`[migrate] Migrations directory not found: ${MIGRATIONS_DIR}`);
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Split a migration file's SQL into UP and DOWN sections.
 *
 * Convention:
 *   Everything before "-- DOWN" is the UP script.
 *   Everything after  "-- DOWN" is the DOWN script.
 *
 * If no "-- DOWN" marker is found the down script is null.
 *
 * @param {string} sql  Full file contents
 * @returns {{ up: string, down: string | null }}
 */
function splitMigration(sql) {
  // Case-insensitive match for "-- DOWN" on its own line
  const downMarker = /^--\s*DOWN\s*$/im;
  const match      = downMarker.exec(sql);

  if (!match) {
    return { up: sql, down: null };
  }

  return {
    up:   sql.slice(0, match.index).trim(),
    down: sql.slice(match.index + match[0].length).trim() || null,
  };
}

/**
 * Apply a single migration file inside a transaction.
 * Records the filename in the `migrations` table on success.
 *
 * @param {import('pg').PoolClient} client
 * @param {string}                  filename
 */
async function applyMigration(client, filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const raw      = fs.readFileSync(filePath, 'utf8');
  const { up }   = splitMigration(raw);

  if (!up) {
    console.warn(`[migrate] ${filename} — UP section is empty, skipping.`);
    return;
  }

  console.log(`[migrate] Applying: ${filename}`);

  await client.query('BEGIN');
  try {
    await client.query(up);
    await client.query(
      'INSERT INTO migrations (filename) VALUES ($1)',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`[migrate] Applied:  ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`[migrate] Failed to apply "${filename}": ${err.message}`);
  }
}

/**
 * Rollback the last applied migration.
 * Runs the DOWN section of that migration's SQL file inside a transaction.
 *
 * @param {import('pg').PoolClient} client
 */
async function rollbackLastMigration(client) {
  await ensureMigrationsTable(client);

  // Find the most recently applied migration
  const { rows } = await client.query(
    'SELECT filename FROM migrations ORDER BY applied_at DESC, id DESC LIMIT 1'
  );

  if (rows.length === 0) {
    console.log('[migrate] No migrations to roll back.');
    return;
  }

  const { filename } = rows[0];
  const filePath     = path.join(MIGRATIONS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[migrate] Migration file not found for rollback: ${filePath}`
    );
  }

  const raw         = fs.readFileSync(filePath, 'utf8');
  const { down }    = splitMigration(raw);

  if (!down) {
    throw new Error(
      `[migrate] "${filename}" has no DOWN section. ` +
      'Write a new compensating migration instead.'
    );
  }

  console.log(`[migrate] Rolling back: ${filename}`);

  await client.query('BEGIN');
  try {
    await client.query(down);
    await client.query(
      'DELETE FROM migrations WHERE filename = $1',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`[migrate] Rolled back: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`[migrate] Failed to roll back "${filename}": ${err.message}`);
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Run all pending migrations in alphabetical order.
 */
async function runMigrations() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files   = getMigrationFiles();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('[migrate] No pending migrations — database is up to date.');
      return;
    }

    console.log(`[migrate] ${pending.length} pending migration(s) to apply.`);

    for (const filename of pending) {
      await applyMigration(client, filename);
    }

    console.log(`[migrate] Done — ${pending.length} migration(s) applied.`);
  } finally {
    client.release();
  }
}

/**
 * Print the status of every migration (applied vs. pending).
 */
async function statusMigrations() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files   = getMigrationFiles();

    if (files.length === 0) {
      console.log('[migrate] No migration files found.');
      return;
    }

    const SEP = '─'.repeat(64);
    console.log(`\nMigration status:\n${SEP}`);
    for (const f of files) {
      const status = applied.has(f) ? 'APPLIED ' : 'PENDING ';
      console.log(`  ${status}  ${f}`);
    }
    const pendingCount = files.filter((f) => !applied.has(f)).length;
    console.log(`${SEP}\n  ${applied.size} applied, ${pendingCount} pending\n`);
  } finally {
    client.release();
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2] || 'up';

  try {
    switch (command) {
      case 'up':
      case undefined:
        await runMigrations();
        break;

      case 'rollback':
        // eslint-disable-next-line no-case-declarations
        const rollbackClient = await pool.connect();
        try {
          await rollbackLastMigration(rollbackClient);
        } finally {
          rollbackClient.release();
        }
        break;

      case 'status':
        await statusMigrations();
        break;

      default:
        console.error(
          `[migrate] Unknown command: "${command}". ` +
          'Valid commands: up | rollback | status'
        );
        process.exitCode = 1;
    }
  } catch (err) {
    console.error('[migrate] Fatal error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Run when invoked directly; skip when imported (e.g. from test setup)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { runMigrations, statusMigrations, rollbackLastMigration };

/**
 * Application Logger  –  src/utils/logger.js
 *
 * Winston-based logger with environment-aware transports:
 *
 *   development  → pretty-printed console output only
 *   production   → structured JSON to console + rotating file transports
 *                  (error.log  – ERROR level and above)
 *                  (combined.log – all levels)
 *
 * All log entries include:
 *   timestamp   ISO-8601 timestamp
 *   level       info | warn | error | debug
 *   message     the log message
 *   ...meta     any additional metadata passed by the caller
 *
 * Usage:
 *   import { logger } from '../utils/logger.js';
 *
 *   logger.info('Server started', { port: 3001 });
 *   logger.warn('Rate limit approaching', { ip, endpoint });
 *   logger.error('DB query failed', { message: err.message, stack: err.stack });
 *   logger.debug('Cache miss', { key });
 */

import { createLogger, format, transports } from 'winston';
import path  from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const isDev = process.env.NODE_ENV !== 'production';

// ─── Log directory ────────────────────────────────────────────────────────────

/** Logs are written next to the project root, not inside src/. */
const LOG_DIR = path.resolve(__dirname, '../../logs');

// ─── Custom formats ───────────────────────────────────────────────────────────

/**
 * Timestamp format used by all transports.
 * Example: 2026-03-16T08:00:00.000Z
 */
const timestampFmt = format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' });

/**
 * Development format: colourised, human-readable single line.
 * Example:  2026-03-16 08:00:00 [info]: Server started {"port":3001}
 */
const devFormat = format.combine(
  timestampFmt,
  format.colorize({ all: true }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? ` ${JSON.stringify(meta)}`
      : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

/**
 * Production format: compact JSON — one structured log object per line.
 * Easy to ingest by log aggregators (Datadog, CloudWatch, Loki, etc.).
 */
const prodFormat = format.combine(
  timestampFmt,
  format.errors({ stack: true }),  // Promote err.stack into the log entry
  format.json()
);

// ─── Transports ───────────────────────────────────────────────────────────────

/** Always present: console transport (pretty in dev, JSON in prod). */
const consoleTransport = new transports.Console({
  format: isDev ? devFormat : prodFormat,
  // In production, suppress debug from the console; debug is file-only
  level: isDev ? 'debug' : 'info',
});

/** Production-only: ERROR and above → error.log */
const errorFileTransport = new transports.File({
  filename: path.join(LOG_DIR, 'error.log'),
  level:    'error',
  format:   prodFormat,
  // Rotate when the file exceeds 20 MB; keep 14 days of archives
  maxsize:  20 * 1024 * 1024,
  maxFiles: 14,
  tailable: true,
});

/** Production-only: all levels → combined.log */
const combinedFileTransport = new transports.File({
  filename: path.join(LOG_DIR, 'combined.log'),
  level:    'debug',
  format:   prodFormat,
  maxsize:  50 * 1024 * 1024,
  maxFiles: 7,
  tailable: true,
});

// ─── Logger instance ──────────────────────────────────────────────────────────

export const logger = createLogger({
  // Base level: debug lets transports apply their own per-transport levels
  level: 'debug',

  // In development: console only (no log files to clutter the workspace)
  transports: isDev
    ? [consoleTransport]
    : [consoleTransport, errorFileTransport, combinedFileTransport],

  // Prevent Winston from crashing the process on unhandled exceptions /
  // promise rejections — log them instead
  exceptionHandlers: isDev
    ? [consoleTransport]
    : [
        new transports.File({
          filename: path.join(LOG_DIR, 'exceptions.log'),
          format:   prodFormat,
        }),
      ],

  rejectionHandlers: isDev
    ? [consoleTransport]
    : [
        new transports.File({
          filename: path.join(LOG_DIR, 'rejections.log'),
          format:   prodFormat,
        }),
      ],

  exitOnError: false,
});

// ─── Stream for Morgan HTTP logging ──────────────────────────────────────────

/**
 * A writable stream compatible with Morgan's `stream` option.
 * Morgan writes a trailing newline; we trim it before passing to Winston.
 *
 * Usage in server.js:
 *   import morgan from 'morgan';
 *   import { morganStream } from './utils/logger.js';
 *   app.use(morgan('combined', { stream: morganStream }));
 */
export const morganStream = {
  write(message) {
    logger.http(message.trimEnd());
  },
};

export default logger;

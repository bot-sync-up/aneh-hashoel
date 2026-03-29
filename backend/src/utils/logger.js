'use strict';

/**
 * Application Logger  --  src/utils/logger.js
 *
 * Pino-based structured logger with environment-aware configuration:
 *
 *   development  -> pretty-printed console output via pino-pretty
 *   production   -> JSON output for log aggregation (Datadog, CloudWatch, Loki, etc.)
 *
 * Log levels (in order): trace, debug, info, warn, error, fatal
 *
 * All log entries include:
 *   time        ISO-8601 timestamp
 *   level       numeric + string level
 *   pid         process ID
 *   service     service name (aneh-hashoel-backend)
 *   env         current NODE_ENV
 *   msg         the log message
 *   ...context  any additional structured data
 *
 * Usage:
 *   const { logger } = require('../utils/logger');
 *
 *   logger.info('Server started');
 *   logger.info({ port: 3001 }, 'Server started');
 *   logger.warn({ ip, endpoint }, 'Rate limit approaching');
 *   logger.error({ err }, 'DB query failed');
 *   logger.debug({ key }, 'Cache miss');
 *
 * Child loggers (recommended for modules):
 *   const log = require('../utils/logger').logger.child({ module: 'imapPoller' });
 *   log.info('Polling started');                    // includes module: 'imapPoller'
 *   log.error({ err }, 'IMAP connection failed');
 *
 * Morgan stream:
 *   const { morganStream } = require('./utils/logger');
 *   app.use(morgan('combined', { stream: morganStream }));
 */

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

// -- Logger configuration ---------------------------------------------------

const transportConfig = isDev
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    }
  : undefined; // In production, use default JSON output to stdout

const logger = pino({
  level: isDev ? 'debug' : 'info',

  // Default fields included in every log entry
  base: {
    service: 'aneh-hashoel-backend',
    env: process.env.NODE_ENV || 'development',
    pid: process.pid,
  },

  // ISO timestamp
  timestamp: pino.stdTimeFunctions.isoTime,

  // In production, format errors with stack traces
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  // Pretty-print in development via pino-pretty transport
  transport: transportConfig,
});

// -- Morgan stream for HTTP logging -----------------------------------------

/**
 * A writable stream compatible with Morgan's `stream` option.
 * Morgan writes a trailing newline; we trim it before passing to pino.
 *
 * Usage in server.js:
 *   const morgan = require('morgan');
 *   const { morganStream } = require('./utils/logger');
 *   app.use(morgan('combined', { stream: morganStream }));
 */
const morganStream = {
  write(message) {
    logger.info(message.trimEnd());
  },
};

module.exports = { logger, morganStream };
module.exports.default = logger;

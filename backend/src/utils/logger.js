/**
 * src/utils/logger.js
 * Minimal structured logger with a pino-style call signature.
 * Replace the console transport with a real logger (pino/winston) if needed.
 */

"use strict";

/* eslint-disable no-console */

function emit(level, args) {
  const prefix = `[${level}]`;
  if (args.length === 0) {
    console[level](prefix);
  } else if (args.length === 1) {
    console[level](prefix, args[0]);
  } else {
    console[level](prefix, args[1], args[0]);
  }
}

const logger = {
  debug: (...args) => emit("debug", args),
  info: (...args) => emit("info", args),
  warn: (...args) => emit("warn", args),
  error: (...args) => emit("error", args),
};

module.exports = logger;

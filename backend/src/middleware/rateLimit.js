/**
 * src/middleware/rateLimit.js
 * Dedicated rate limiters for different route sensitivity levels.
 */

"use strict";

const rateLimit = require("express-rate-limit");

/**
 * Strict rate limiting — 20 requests per minute.
 * Applied to sensitive lookups like accounts and payments.
 *
 * Overridable for the same reason as the global limiter in server.js:
 * express-rate-limit holds its store in a process-global registry, so specs
 * that exercise these routes share one 20-request budget and start failing
 * each other with 429s. Defaults are unchanged.
 */
const strictLimiter = rateLimit({
  windowMs: Number(process.env.STRICT_RATE_LIMIT_WINDOW_MS) || 1 * 60 * 1000,
  max: Number(process.env.STRICT_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests to sensitive routes, please wait 1 minute." },
});

module.exports = { strictLimiter };

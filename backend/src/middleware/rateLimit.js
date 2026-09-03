/**
 * src/middleware/rateLimit.js
 * Dedicated rate limiters for different route sensitivity levels.
 */

"use strict";

const rateLimit = require("express-rate-limit");

/**
 * Strict rate limiting — 20 requests per minute.
 * Applied to sensitive lookups like accounts and payments.
 */
const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests to sensitive routes, please wait 1 minute." },
});

module.exports = { strictLimiter };

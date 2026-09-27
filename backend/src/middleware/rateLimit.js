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

/**
 * Authentication challenge requests — 5 requests per minute per IP.
 */
const authChallengeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication challenge requests, please wait 1 minute." },
});

/**
 * Authentication verification requests — 5 requests per minute per IP.
 */
const authVerifyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication verification requests, please wait 1 minute." },
});

module.exports = { strictLimiter, authChallengeLimiter, authVerifyLimiter };

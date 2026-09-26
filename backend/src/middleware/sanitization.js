/**
 * src/middleware/sanitization.js
 * Middleware for parameter sanitization and validation.
 */

"use strict";

/**
 * Sanitizes and validates the Stellar public key held in the named route param.
 * Expected format: G... (56 chars)
 *
 * @param {string} paramName - Route param holding the public key
 */
function sanitizeKeyParam(req, res, next, paramName) {
  const publicKey = req.params[paramName];

  if (!publicKey) {
    return next();
  }

  // 1. Strip non-alphanumeric characters
  const sanitized = String(publicKey).replace(/[^a-zA-Z0-9]/g, "");

  // 2. Return 400 if obviously invalid
  // Stellar public keys are exactly 56 chars and start with 'G'
  if (sanitized.length !== 56 || !sanitized.startsWith("G")) {
    return res.status(400).json({
      error: "Invalid Stellar public key format",
    });
  }

  // Update params with sanitized version
  req.params[paramName] = sanitized;
  next();
}

/**
 * Sanitizes and validates a Stellar public key from the `:publicKey` route param.
 * Expected format: G... (56 chars)
 */
function sanitizePublicKey(req, res, next) {
  return sanitizeKeyParam(req, res, next, "publicKey");
}

/**
 * Builds middleware that sanitizes a Stellar public key from a named route param.
 * Use this for routes whose key param is not literally `:publicKey`, e.g.
 * `:creatorPublicKey` on the tips routes.
 *
 * @param {string} paramName - Route param holding the public key
 * @returns {Function} Express middleware
 */
function sanitizePublicKeyParam(paramName) {
  return function sanitizeNamedPublicKey(req, res, next) {
    return sanitizeKeyParam(req, res, next, paramName);
  };
}

/**
 * Sanitizes a username by trimming and lowercasing.
 */
function sanitizeUsername(req, res, next) {
  const { username } = req.params;

  if (username) {
    req.params.username = username.trim().toLowerCase();
  }

  next();
}

module.exports = { sanitizePublicKey, sanitizePublicKeyParam, sanitizeUsername };

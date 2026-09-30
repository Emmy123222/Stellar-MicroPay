/**
 * src/middleware/sanitization.js
 * Middleware for parameter sanitization and validation.
 */

"use strict";

/**
 * Stellar public (account) keys are 56-character base32 strings starting
 * with 'G', encoding a 32-byte ed25519 key plus a version byte and checksum.
 * Base32 excludes 0, 1, 8, 9 — hence the [A-Z2-7] character class.
 */
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

/**
 * Returns a middleware that validates the named route param against the
 * Stellar public key format before it reaches a controller/service.
 * Responds with 400 on any mismatch — it does not attempt to sanitize
 * or coerce the value, since a key that doesn't already match is invalid.
 */
function validatePublicKey(paramName = "publicKey") {
  return function (req, res, next) {
    const value = req.params[paramName];

    if (!value || !STELLAR_PUBLIC_KEY_PATTERN.test(value)) {
      return res.status(400).json({ error: "Invalid Stellar public key" });
    }

    next();
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

module.exports = { validatePublicKey, sanitizeUsername };

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

/**
 * Sanitizes a Stellar public key route param in place: trims whitespace and
 * normalizes case before stricter validation happens downstream.
 */
function sanitizePublicKey(req, res, next) {
  for (const value of Object.values(req.params)) {
    if (typeof value === "string" && /^G[a-z0-9]{55}$/i.test(value.trim())) {
      req.params[Object.keys(req.params).find((k) => req.params[k] === value)] = value.trim().toUpperCase();
    }
  }

  next();
}

/**
 * Returns true for plain objects ({}) only, so Buffers, Dates and other
 * non-JSON values are left untouched.
 */
function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * Recursively trims string values and strips null bytes.
 *
 * Sets state.hasNullByte to true whenever a null byte is found so the caller
 * can fail closed instead of forwarding a sanitized-but-malicious payload.
 */
function sanitizeValue(value, state) {
  if (typeof value === "string") {
    if (value.includes("\u0000")) {
      state.hasNullByte = true;
      value = value.split("\u0000").join("");
    }
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, state));
  }

  if (isPlainObject(value)) {
    const sanitized = {};
    for (const key of Object.keys(value)) {
      sanitized[key] = sanitizeValue(value[key], state);
    }
    return sanitized;
  }

  return value;
}

/**
 * Global input sanitization middleware.
 *
 * Trims every string in the request body/query and strips null bytes. Because
 * null bytes are never valid in JSON string values and are commonly used to
 * bypass validation, a request containing one is rejected with 400.
 *
 * Mount this globally (before route mounts) so every POST/PUT handler is
 * covered without having to add the middleware route by route.
 */
function sanitizeRequest(req, res, next) {
  const state = { hasNullByte: false };

  if (req.body !== undefined) {
    req.body = sanitizeValue(req.body, state);
  }

  if (isPlainObject(req.query)) {
    for (const key of Object.keys(req.query)) {
      req.query[key] = sanitizeValue(req.query[key], state);
    }
  }

  if (state.hasNullByte) {
    return res.status(400).json({ error: "Request contains null bytes" });
  }

  next();
}

module.exports = {
  validatePublicKey,
  sanitizeUsername,
  sanitizePublicKey,
  sanitizeRequest,
};

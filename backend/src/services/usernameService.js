/* eslint-disable */
/**
 * src/services/usernameService.js
 * Business logic for username-to-public-key mapping and resolution.
 *
 * Storage: persistent JSON-file store (backend/data/usernames.json) with
 * atomic writes — registrations survive server restarts (Issue #1056).
 * Lookup is O(1) via the in-memory index maintained by the store; see
 * src/storage/usernameStore.js for the schema migration path to PostgreSQL.
 *
 * The exported function contract is unchanged from the v1 in-memory service,
 * so routes/controllers/federation require no changes (acceptance criterion:
 * "Existing API contract unchanged").
 */

"use strict";

const { createUsernameStore } = require("../storage/usernameStore");

// Persistent store: JSON file + atomic writes + hot in-memory index.
const store = createUsernameStore();

// Flush pending writes on process shutdown so debounced registrations are
// never lost.
process.on("exit", () => {
  try {
    store.flushSync();
  } catch {
    // nothing more we can do during shutdown
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    try {
      store.flushSync();
    } catch {
      // ignore — the process is terminating anyway
    }
  });
}

/**
 * Register a new username with a public key.
 * @param {string} username - The username to register
 * @param {string} publicKey - The Stellar public key
 */
function registerUsername(username, publicKey) {
  validateUsername(username);
  validatePublicKey(publicKey);

  // Check if username already exists
  if (store.has(username)) {
    const error = new Error("Username already registered");
    error.status = 409;
    throw error;
  }

  // Check if public key is already registered to another username
  for (const [, existing] of store.entries()) {
    if (existing.publicKey === publicKey) {
      const error = new Error("Public key already registered to another username");
      error.status = 409;
      throw error;
    }
  }

  store.set(username, publicKey);
  return { username, publicKey };
}

/**
 * Resolve a username to its public key.
 * @param {string} username - The username to resolve
 * @returns {string} The public key associated with the username
 */
function resolveUsername(username) {
  validateUsername(username);

  const existing = store.get(username);
  if (!existing) {
    const error = new Error("Username not found");
    error.status = 404;
    throw error;
  }

  return { username, publicKey: existing.publicKey };
}

/**
 * Get all registered usernames (for debugging/admin purposes).
 * @returns {Array} Array of { username, publicKey } objects
 */
function getAllUsernames() {
  return store.entries().map(([username, existing]) => ({
    username,
    publicKey: existing.publicKey,
  }));
}

/**
 * Remove a username registration.
 * @param {string} username - The username to remove
 */
function removeUsername(username) {
  validateUsername(username);

  if (!store.has(username)) {
    const error = new Error("Username not found");
    error.status = 404;
    throw error;
  }

  store.remove(username);
  return { username };
}

/**
 * Validate username format.
 * @param {string} username - The username to validate
 */
function validateUsername(username) {
  if (!username) {
    const error = new Error("Username is required");
    error.status = 400;
    throw error;
  }

  // Username must be 3-20 characters, alphanumeric, no spaces
  if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
    const error = new Error(
      "Username must be 3-20 characters long and contain only letters and numbers"
    );
    error.status = 400;
    throw error;
  }
}

/**
 * Validate Stellar public key format.
 * @param {string} publicKey - The public key to validate
 */
function validatePublicKey(publicKey) {
  if (!publicKey) {
    const error = new Error("Public key is required");
    error.status = 400;
    throw error;
  }

  // Stellar public keys start with 'G' and are 56 characters (G + 55 alphanumerics)
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const error = new Error("Invalid Stellar public key format");
    error.status = 400;
    throw error;
  }
}

module.exports = {
  registerUsername,
  resolveUsername,
  getAllUsernames,
  removeUsername,
  validateUsername,
  validatePublicKey,
  /** Flushes any pending debounced store write (used on graceful shutdown/tests). */
  flushSync: () => store.flushSync(),
};

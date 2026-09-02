/**
 * src/services/usernameService.js
 * Business logic for username-to-public-key mapping and resolution.
 * Uses in-memory storage for v1 (can be migrated to database later).
 *
 * Canonical form: usernames are case-insensitive. The Map is keyed by the
 * lowercased ("canonical") form of the username so that "Alice123",
 * "alice123", and "ALICE123" all refer to the same registration — this
 * prevents case-based aliasing where two callers could otherwise register
 * what looks like the same handle with different casing. The canonical
 * (lowercased) form is also what's returned to callers, so display layers
 * should treat it as the source of truth for the registered username.
 */

"use strict";

// In-memory storage for canonicalUsername → publicKey mapping
const usernameMap = new Map();

/**
 * Canonicalize a username to its case-insensitive storage/lookup form.
 * @param {string} username - The username to canonicalize
 * @returns {string} The canonical (lowercased) form of the username
 */
function canonicalizeUsername(username) {
  return username.toLowerCase();
}

/**
 * Register a new username with a public key.
 * @param {string} username - The username to register
 * @param {string} publicKey - The Stellar public key
 */
function registerUsername(username, publicKey) {
  validateUsername(username);
  validatePublicKey(publicKey);

  const canonicalUsername = canonicalizeUsername(username);

  // Check if username already exists (case-insensitive)
  if (usernameMap.has(canonicalUsername)) {
    const error = new Error("Username already registered");
    error.status = 409;
    throw error;
  }

  // Check if public key is already registered to another username
  for (const existingPublicKey of usernameMap.values()) {
    if (existingPublicKey === publicKey) {
      const error = new Error("Public key already registered to another username");
      error.status = 409;
      throw error;
    }
  }

  usernameMap.set(canonicalUsername, publicKey);
  return { username: canonicalUsername, publicKey };
}

/**
 * Resolve a username to its public key.
 * @param {string} username - The username to resolve
 * @returns {string} The public key associated with the username
 */
function resolveUsername(username) {
  validateUsername(username);

  const canonicalUsername = canonicalizeUsername(username);
  const publicKey = usernameMap.get(canonicalUsername);
  if (!publicKey) {
    const error = new Error("Username not found");
    error.status = 404;
    throw error;
  }

  return { username: canonicalUsername, publicKey };
}

/**
 * Get all registered usernames (for debugging/admin purposes).
 * @returns {Array} Array of { username, publicKey } objects
 */
function getAllUsernames() {
  return Array.from(usernameMap.entries()).map(([username, publicKey]) => ({
    username,
    publicKey,
  }));
}

/**
 * Remove a username registration.
 * @param {string} username - The username to remove
 */
function removeUsername(username) {
  validateUsername(username);

  const canonicalUsername = canonicalizeUsername(username);

  if (!usernameMap.has(canonicalUsername)) {
    const error = new Error("Username not found");
    error.status = 404;
    throw error;
  }

  usernameMap.delete(canonicalUsername);
  return { username: canonicalUsername };
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

/**
 * Create an isolated username service for a request scope or test.
 * The default exports below retain the legacy process-wide service API.
 */
function createUsernameService(store = new Map()) {
  return {
    registerUsername(username, publicKey) {
      validateUsername(username);
      validatePublicKey(publicKey);
      const canonical = canonicalizeUsername(username);
      if (store.has(canonical)) {
        const error = new Error("Username already registered");
        error.status = 409;
        throw error;
      }
      for (const existingPublicKey of store.values()) {
        if (existingPublicKey === publicKey) {
          const error = new Error("Public key already registered to another username");
          error.status = 409;
          throw error;
        }
      }
      store.set(canonical, publicKey);
      return { username: canonical, publicKey };
    },
    resolveUsername(username) {
      validateUsername(username);
      const canonical = canonicalizeUsername(username);
      const publicKey = store.get(canonical);
      if (!publicKey) {
        const error = new Error("Username not found");
        error.status = 404;
        throw error;
      }
      return { username: canonical, publicKey };
    },
    getAllUsernames: () => Array.from(store.entries()).map(([username, publicKey]) => ({ username, publicKey })),
    removeUsername(username) {
      validateUsername(username);
      const canonical = canonicalizeUsername(username);
      if (!store.delete(canonical)) {
        const error = new Error("Username not found");
        error.status = 404;
        throw error;
      }
      return { username: canonical };
    },
    clearUsernames: () => store.clear(),
    store,
  };
}

/**
 * Clear all registered usernames (used for test isolation / reset).
 */
function clearUsernames() {
  usernameMap.clear();
}

module.exports = {
  registerUsername,
  resolveUsername,
  getAllUsernames,
  removeUsername,
  validateUsername,
  validatePublicKey,
  canonicalizeUsername,
  clearUsernames,
  usernameMap,
  createUsernameService,
};

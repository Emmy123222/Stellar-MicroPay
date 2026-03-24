/* eslint-disable */
/**
 * src/services/usernameService.js
 * Business logic for username-to-public-key mapping and resolution.
 * Uses in-memory storage for v1 (can be migrated to database later).
 */

"use strict";

// In-memory storage for username → publicKey mapping
const usernameMap = new Map();

/**
 * Register a new username with a public key.
 * @param {string} username - The username to register
 * @param {string} publicKey - The Stellar public key
 */
function registerUsername(username, publicKey) {
  validateUsername(username);
  validatePublicKey(publicKey);

  // Check if username already exists
  if (usernameMap.has(username)) {
    const error = new Error("Username already registered");
    error.status = 409;
    throw error;
  }

 // Check if public key is already registered to another username
  /* eslint-disable no-unused-vars */
 // eslint-disable-next-line no-unused-vars
  for (const [unused, existingPublicKey] of usernameMap.entries()) {    if (existingPublicKey === publicKey) {
      const error = new Error("Public key already registered to another username");
      error.status = 409;
      throw error;
    }
  }
  /* eslint-enable no-unused-vars */

  usernameMap.set(username, publicKey);
  return { username, publicKey };
}

/**
 * Resolve a username to its public key.
 * @param {string} username - The username to resolve
 * @returns {string} The public key associated with the username
 */
function resolveUsername(username) {
  validateUsername(username);

  const publicKey = usernameMap.get(username);
  if (!publicKey) {
    const error = new Error("Username not found");
    error.status = 404;
    throw error;
  }

  return { username, publicKey };
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

  if (!usernameMap.has(username)) {
    const error = new Error("Username not found");
    error.status = 404;
    throw error;
  }

  usernameMap.delete(username);
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
};
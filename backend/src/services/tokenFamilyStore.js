/**
 * src/services/tokenFamilyStore.js
 * In-memory store for refresh-token families (rotation + revocation tracking).
 * Pattern mirrors webhookStore.js / tipsService.js — plain Map, module-level.
 *
 * A "family" is the chain of refresh tokens descending from a single SEP-0010
 * login. Each refresh rotates the family's currentJti; presenting a jti that
 * isn't the family's current one means an already-rotated token was reused
 * (theft signal), so the whole family is revoked.
 */

"use strict";

const crypto = require("crypto");

/**
 * @typedef {Object} TokenFamily
 * @property {string} familyId
 * @property {string} publicKey
 * @property {string} currentJti   - jti of the newest token issued for this family
 * @property {boolean} revoked
 * @property {string} createdAt    - ISO timestamp
 */

/** @type {Map<string, TokenFamily>} */
const families = new Map();

/**
 * Start a new token family (called at login). Returns the identifiers to embed
 * in the issued JWT's `fam` and `jti` claims.
 * @param {string} publicKey
 * @returns {{ familyId: string, jti: string }}
 */
function createFamily(publicKey) {
  const familyId = crypto.randomUUID();
  const jti = crypto.randomUUID();
  families.set(familyId, {
    familyId,
    publicKey,
    currentJti: jti,
    revoked: false,
    createdAt: new Date().toISOString(),
  });
  return { familyId, jti };
}

/**
 * @param {string} familyId
 * @returns {TokenFamily | undefined}
 */
function getFamily(familyId) {
  return families.get(familyId);
}

/**
 * Rotate a family to a new jti (called on successful refresh).
 * @param {string} familyId
 * @returns {string} the new jti
 */
function rotateFamily(familyId) {
  const family = families.get(familyId);
  const jti = crypto.randomUUID();
  family.currentJti = jti;
  return jti;
}

/**
 * @param {string} familyId
 */
function revokeFamily(familyId) {
  const family = families.get(familyId);
  if (family) {
    family.revoked = true;
  }
}

/**
 * Revoke every family belonging to a public key ("log out of all devices").
 * @param {string} publicKey
 * @returns {number} number of families revoked
 */
function revokeAllFamiliesForUser(publicKey) {
  let count = 0;
  for (const family of families.values()) {
    if (family.publicKey === publicKey && !family.revoked) {
      family.revoked = true;
      count++;
    }
  }
  return count;
}

module.exports = {
  createFamily,
  getFamily,
  rotateFamily,
  revokeFamily,
  revokeAllFamiliesForUser,
};

/**
 * src/services/idempotencyService.js
 * Idempotency layer for payment submission.
 *
 * Stores the response produced for a client-supplied idempotency key so that
 * retries (e.g. after a network timeout) replay the original response instead
 * of submitting the payment twice.
 *
 * Uses in-memory storage — the same persistence layer as the username and tip
 * services (can be migrated to a shared database later).
 */

"use strict";

// How long a cached response stays valid before it can be re-submitted.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory storage: Map<idempotencyKey, { status, body, expiresAt }>
const idempotencyStore = new Map();

// RFC 4122 UUID (any version) — the client-generated key format.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate an idempotency key.
 * @param {string} key
 * @returns {boolean} True when the key is a well-formed UUID.
 */
function isValidKey(key) {
  return typeof key === "string" && UUID_PATTERN.test(key);
}

/**
 * Fetch a cached response for a key.
 * Expired entries are evicted lazily on access.
 * @param {string} key
 * @returns {{ status: number, body: unknown } | null}
 */
function get(key) {
  if (!key) return null;

  const entry = idempotencyStore.get(key);
  if (!entry) return null;

  if (Date.now() >= entry.expiresAt) {
    idempotencyStore.delete(key);
    return null;
  }

  return { status: entry.status, body: entry.body };
}

/**
 * Cache a response for a key.
 * @param {string} key
 * @param {{ status?: number, body: unknown }} response
 * @param {number} [ttlMs] - Optional TTL override (mainly for tests).
 */
function set(key, response, ttlMs = DEFAULT_TTL_MS) {
  if (!key) return;

  idempotencyStore.set(key, {
    status: response.status || 200,
    body: response.body,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Clear cached responses. Without a key the whole store is emptied.
 * @param {string} [key]
 */
function clear(key) {
  if (key === undefined) {
    idempotencyStore.clear();
    return;
  }
  idempotencyStore.delete(key);
}

module.exports = {
  DEFAULT_TTL_MS,
  isValidKey,
  get,
  set,
  clear,
};

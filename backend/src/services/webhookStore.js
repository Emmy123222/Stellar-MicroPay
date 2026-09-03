/**
 * src/services/webhookStore.js
 * Durable store for registered webhooks and their monitor cursors, backed by
 * SQLite (see src/db/webhookDb.js). Registrations survive process restarts
 * and can be shared across replicas by pointing every instance's
 * WEBHOOK_DB_PATH at the same durable volume (#768).
 */

"use strict";

const { db } = require("../db/webhookDb");

/**
 * @typedef {Object} Webhook
 * @property {string} id
 * @property {string} publicKey  - Stellar public key being monitored
 * @property {string} url        - Destination URL for POST notifications
 * @property {string} secret     - HMAC signing secret (never expose in API responses)
 * @property {string} createdAt  - ISO timestamp
 */

function rowToWebhook(row) {
  if (!row) return undefined;
  return {
    id: String(row.id),
    publicKey: row.public_key,
    url: row.url,
    secret: row.secret,
    createdAt: row.created_at,
  };
}

const insertStmt = db.prepare(
  `INSERT INTO webhooks (public_key, url, secret, created_at) VALUES (?, ?, ?, ?)`
);
const findByKeyAndUrlStmt = db.prepare(
  `SELECT * FROM webhooks WHERE public_key = ? AND url = ?`
);
const findByKeyStmt = db.prepare(`SELECT * FROM webhooks WHERE public_key = ?`);
const findByIdStmt = db.prepare(`SELECT * FROM webhooks WHERE id = ?`);
const deleteByIdStmt = db.prepare(`DELETE FROM webhooks WHERE id = ?`);
const findAllStmt = db.prepare(`SELECT * FROM webhooks`);

/**
 * Register a new webhook.
 * Accepts either positional args (publicKey, url, secret) or a single
 * object ({ publicKey, url, secret }) so both call sites work.
 *
 * Enforces uniqueness on (publicKey, url): re-registering the same pair
 * returns the existing record instead of creating a duplicate.
 *
 * @param {string | { publicKey: string, url: string, secret: string }} publicKeyOrData
 * @param {string} [urlArg]
 * @param {string} [secretArg]
 * @returns {Webhook}
 */
function registerWebhook(publicKeyOrData, urlArg, secretArg) {
  let publicKey, url, secret;
  if (typeof publicKeyOrData === "object" && publicKeyOrData !== null) {
    ({ publicKey, url, secret } = publicKeyOrData);
  } else {
    publicKey = publicKeyOrData;
    url = urlArg;
    secret = secretArg;
  }

  const existing = findByKeyAndUrlStmt.get(publicKey, url);
  if (existing) {
    return rowToWebhook(existing);
  }

  const createdAt = new Date().toISOString();
  const info = insertStmt.run(publicKey, url, secret, createdAt);
  return {
    id: String(info.lastInsertRowid),
    publicKey,
    url,
    secret,
    createdAt,
  };
}

/**
 * Get all webhooks for a given Stellar public key.
 * @param {string} publicKey
 * @returns {Webhook[]}
 */
function getWebhooksByPublicKey(publicKey) {
  return findByKeyStmt.all(publicKey).map(rowToWebhook);
}

/**
 * Get a single webhook by id.
 * @param {string} id
 * @returns {Webhook | undefined}
 */
function getWebhookById(id) {
  return rowToWebhook(findByIdStmt.get(id));
}

/**
 * Delete a webhook by id.
 * @param {string} id
 * @returns {boolean} true if deleted, false if not found
 */
function deleteWebhook(id) {
  return deleteByIdStmt.run(id).changes > 0;
}

/**
 * Return all registered webhooks (used by the monitor on startup).
 * @returns {Webhook[]}
 */
function getAllWebhooks() {
  return findAllStmt.all().map(rowToWebhook);
}

// ── Monitor cursors ──────────────────────────────────────────────────────────
// Persist the last-seen Horizon paging token per public key so monitors can
// resume from where they left off after a restart instead of re-subscribing
// from "now" (which would silently drop any payment received while offline).

const upsertCursorStmt = db.prepare(`
  INSERT INTO monitor_cursors (public_key, cursor, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT (public_key) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at
`);
const getCursorStmt = db.prepare(`SELECT cursor FROM monitor_cursors WHERE public_key = ?`);

/**
 * Persist the last-processed Horizon paging token for a monitored account.
 * @param {string} publicKey
 * @param {string} cursor
 */
function saveMonitorCursor(publicKey, cursor) {
  upsertCursorStmt.run(publicKey, cursor, new Date().toISOString());
}

/**
 * Get the last-persisted Horizon paging token for a monitored account.
 * @param {string} publicKey
 * @returns {string | undefined}
 */
function getMonitorCursor(publicKey) {
  return getCursorStmt.get(publicKey)?.cursor;
}

/** Create an isolated webhook store for tests or an independently configured app. */
function createWebhookStore(store = new Map(), counter = { value: 1 }) {
  return {
    registerWebhook(publicKeyOrData, urlArg, secretArg) {
      let publicKey, url, secret;
      if (typeof publicKeyOrData === "object" && publicKeyOrData !== null) ({ publicKey, url, secret } = publicKeyOrData);
      else ({ publicKey, url, secret } = { publicKey: publicKeyOrData, url: urlArg, secret: secretArg });
      const webhook = { id: String(counter.value++), publicKey, url, secret, createdAt: new Date().toISOString() };
      store.set(webhook.id, webhook);
      return webhook;
    },
    getWebhooksByPublicKey: (publicKey) => Array.from(store.values()).filter((webhook) => webhook.publicKey === publicKey),
    getWebhookById: (id) => store.get(id),
    deleteWebhook: (id) => store.delete(id),
    getAllWebhooks: () => Array.from(store.values()),
    store,
  };
}

module.exports = {
  registerWebhook,
  getWebhooksByPublicKey,
  getWebhookById,
  deleteWebhook,
  getAllWebhooks,
  createWebhookStore,
  saveMonitorCursor,
  getMonitorCursor,
};

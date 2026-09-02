/**
 * src/services/webhookStore.js
 * In-memory store for registered webhooks.
 * Pattern mirrors tipsService.js / usernameService.js — plain Map, module-level.
 */

"use strict";

/** @type {Map<string, Webhook>} */
const webhooks = new Map();
let nextId = 1;

/**
 * @typedef {Object} Webhook
 * @property {string} id
 * @property {string} publicKey  - Stellar public key being monitored
 * @property {string} url        - Destination URL for POST notifications
 * @property {string} secret     - HMAC signing secret (never expose in API responses)
 * @property {string} createdAt  - ISO timestamp
 */

/**
 * Register a new webhook.
 * Accepts either positional args (publicKey, url, secret) or a single
 * object ({ publicKey, url, secret }) so both call sites work.
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
  const id = String(nextId++);
  const webhook = {
    id,
    publicKey,
    url,
    secret,
    createdAt: new Date().toISOString(),
  };
  webhooks.set(id, webhook);
  return webhook;
}

/**
 * Get all webhooks for a given Stellar public key.
 * @param {string} publicKey
 * @returns {Webhook[]}
 */
function getWebhooksByPublicKey(publicKey) {
  return Array.from(webhooks.values()).filter((w) => w.publicKey === publicKey);
}

/**
 * Get a single webhook by id.
 * @param {string} id
 * @returns {Webhook | undefined}
 */
function getWebhookById(id) {
  return webhooks.get(id);
}

/**
 * Delete a webhook by id.
 * @param {string} id
 * @returns {boolean} true if deleted, false if not found
 */
function deleteWebhook(id) {
  return webhooks.delete(id);
}

/**
 * Return all registered webhooks (used by the monitor on startup).
 * @returns {Webhook[]}
 */
function getAllWebhooks() {
  return Array.from(webhooks.values());
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
};

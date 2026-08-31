/**
 * src/routes/webhooks.js
 * Webhook registration, listing, and deletion endpoints.
 *
 * POST   /api/webhooks            — register a webhook + start monitoring
 * GET    /api/webhooks/:publicKey — list webhooks for an account (no secret)
 * DELETE /api/webhooks/:id        — remove a webhook (200 / { success } on success)
 */

"use strict";

const { StrKey } = require("@stellar/stellar-sdk");
const express = require("express");
const router = express.Router();

const { strictLimiter } = require("../middleware/rateLimit");
const {
  registerWebhook,
  getWebhooksByPublicKey,
  deleteWebhook,
} = require("../services/webhookService");

/**
 * Strip the secret field before sending a webhook to the client.
 * @param {{ secret?: string, [key: string]: unknown }} webhook
 */
function sanitizeWebhook({ secret: _secret, ...rest }) {
  return rest;
}

/**
 * POST /api/webhooks
 * Body: { publicKey, url, secret }
 */
router.post("/", strictLimiter, (req, res) => {
  const { publicKey, url, secret } = req.body ?? {};

  // ── Field presence ──────────────────────────────────────────────────────────
  if (!publicKey || !url || !secret) {
    return res.status(400).json({ error: "publicKey, url, and secret are required" });
  }

  if (typeof publicKey !== "string" || !publicKey.trim()) {
    return res.status(400).json({ error: "publicKey must be a non-empty string" });
  }
  if (typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "url must be a non-empty string" });
  }
  if (typeof secret !== "string" || !secret.trim()) {
    return res.status(400).json({ error: "secret must be a non-empty string" });
  }

  // ── publicKey validation ────────────────────────────────────────────────────
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    return res.status(400).json({ error: "Invalid Stellar public key" });
  }

  // ── URL validation — must use HTTPS ─────────────────────────────────────────
  if (!url.startsWith("https://")) {
    return res.status(400).json({ error: "url must start with https://" });
  }

  const webhook = registerWebhook(publicKey, url, secret);
  // ensureMonitored is called inside webhookService.registerWebhook

  // Return { success: true, webhook: <without secret> }
  return res.status(201).json({ success: true, webhook: sanitizeWebhook(webhook) });
});

/**
 * GET /api/webhooks/:publicKey
 * Returns { webhooks: [...] } with secrets stripped.
 */
router.get("/:publicKey", strictLimiter, (req, res) => {
  const { publicKey } = req.params;
  const hooks = getWebhooksByPublicKey(publicKey);
  return res.status(200).json({ webhooks: hooks.map(sanitizeWebhook) });
});

/**
 * DELETE /api/webhooks/:id
 * Returns { success: true } on success, 404 if not found.
 */
router.delete("/:id", strictLimiter, (req, res) => {
  const { id } = req.params;
  const deleted = deleteWebhook(id);

  if (!deleted) {
    return res.status(404).json({ error: "Webhook not found" });
  }

  return res.status(200).json({ success: true });
});

module.exports = router;

"use strict";

const express = require("express");
const router = express.Router();
const { registerWebhook, getWebhooksByPublicKey, deleteWebhook } = require("../services/webhookService");

/**
 * POST /api/webhooks
 * Register a webhook for a Stellar account
 * Body: { publicKey, url, secret }
 */
router.post("/", (req, res) => {
  const { publicKey, url, secret } = req.body;
  if (!publicKey || !url || !secret) {
    return res.status(400).json({ error: "publicKey, url, and secret are required" });
  }
  try {
    const webhook = registerWebhook(publicKey, url, secret);
    return res.status(201).json({ success: true, webhook });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/webhooks/:publicKey
 * Get all webhooks for a Stellar account
 */
router.get("/:publicKey", (req, res) => {
  const { publicKey } = req.params;
  const hooks = getWebhooksByPublicKey(publicKey);
  return res.json({ webhooks: hooks });
});

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook by ID
 */
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  const deleted = deleteWebhook(id);
  if (!deleted) {
    return res.status(404).json({ error: "Webhook not found" });
  }
  return res.json({ success: true, message: `Webhook ${id} deleted` });
});

module.exports = router;

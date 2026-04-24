/**
 * src/routes/webhooks.js
 * Webhook management routes for Stellar payment notifications.
 */

"use strict";

const express = require("express");
const webhookService = require("../services/webhookService");

const router = express.Router();

/**
 * Validate Stellar public key format
 */
function isValidStellarPublicKey(publicKey) {
  return typeof publicKey === "string" && 
         publicKey.startsWith("G") && 
         publicKey.length === 56;
}

/**
 * POST /api/webhooks
 * Register a new webhook for payment notifications
 */
router.post("/", (req, res) => {
  const { publicKey, url, secret } = req.body;

  // Validate required fields
  if (!publicKey || !url || !secret) {
    return res.status(400).json({ 
      error: "Missing required fields: publicKey, url, secret" 
    });
  }

  // Validate public key format
  if (!isValidStellarPublicKey(publicKey)) {
    return res.status(400).json({ 
      error: "Invalid Stellar public key format" 
    });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (err) {
    return res.status(400).json({ 
      error: "Invalid URL format" 
    });
  }

  try {
    const webhook = webhookService.registerWebhook(publicKey, url, secret);
    
    res.status(201).json({
      id: webhook.id,
      publicKey: webhook.publicKey,
      url: webhook.url,
      createdAt: webhook.createdAt
    });
  } catch (error) {
    console.error("Error registering webhook:", error);
    res.status(500).json({ error: "Failed to register webhook" });
  }
});

/**
 * GET /api/webhooks/:publicKey
 * Get all webhooks for a public key
 */
router.get("/:publicKey", (req, res) => {
  const { publicKey } = req.params;

  if (!isValidStellarPublicKey(publicKey)) {
    return res.status(400).json({ 
      error: "Invalid Stellar public key format" 
    });
  }

  try {
    const webhooks = webhookService.getWebhooksByPublicKey(publicKey);
    
    // Return webhooks without secrets
    const safeWebhooks = webhooks.map(webhook => ({
      id: webhook.id,
      publicKey: webhook.publicKey,
      url: webhook.url,
      createdAt: webhook.createdAt
    }));

    res.json(safeWebhooks);
  } catch (error) {
    console.error("Error fetching webhooks:", error);
    res.status(500).json({ error: "Failed to fetch webhooks" });
  }
});

/**
 * DELETE /api/webhooks/:id
 * Remove a webhook by ID
 */
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: "Webhook ID is required" });
  }

  try {
    const deleted = webhookService.deleteWebhook(id);
    
    if (!deleted) {
      return res.status(404).json({ error: "Webhook not found" });
    }

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting webhook:", error);
    res.status(500).json({ error: "Failed to delete webhook" });
  }
});

module.exports = router;
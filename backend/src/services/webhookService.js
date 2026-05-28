"use strict";

const crypto = require("crypto");
const { Horizon } = require("@stellar/stellar-sdk");
const logger = require("../utils/logger");
require("dotenv").config();

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);

// In-memory store: { id, publicKey, url, secret, createdAt }
const webhooks = new Map();
let nextId = 1;

function registerWebhook(publicKey, url, secret) {
  const id = String(nextId++);
  const webhook = { id, publicKey, url, secret, createdAt: new Date().toISOString() };
  webhooks.set(id, webhook);
  startMonitoring(webhook);
  logger.info(JSON.stringify({ type: "webhook_registered", id, publicKey, url }));
  return webhook;
}

function getWebhooksByPublicKey(publicKey) {
  return Array.from(webhooks.values()).filter(w => w.publicKey === publicKey);
}

function deleteWebhook(id) {
  const exists = webhooks.has(id);
  if (exists) {
    webhooks.delete(id);
    logger.info(JSON.stringify({ type: "webhook_deleted", id }));
  }
  return exists;
}

function signPayload(secret, payload) {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

async function deliverWebhook(webhook, payload) {
  const signature = signPayload(webhook.secret, payload);
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.error(JSON.stringify({ type: "webhook_delivery_failed", id: webhook.id, status: res.status, url: webhook.url }));
    } else {
      logger.info(JSON.stringify({ type: "webhook_delivered", id: webhook.id, url: webhook.url }));
    }
  } catch (err) {
    logger.error(JSON.stringify({ type: "webhook_delivery_error", id: webhook.id, url: webhook.url, error: err.message }));
  }
}

const activeStreams = new Map();

function startMonitoring(webhook) {
  if (activeStreams.has(webhook.publicKey)) return;

  const closeStream = server
    .payments()
    .forAccount(webhook.publicKey)
    .cursor("now")
    .stream({
      onmessage: async (payment) => {
        if (payment.type !== "payment" || payment.to !== webhook.publicKey) return;
        const payload = {
          event: "payment.received",
          publicKey: webhook.publicKey,
          payment: {
            id: payment.id,
            from: payment.from,
            to: payment.to,
            amount: payment.amount,
            asset: payment.asset_type === "native" ? "XLM" : payment.asset_code,
            createdAt: payment.created_at,
          },
        };
        const hooks = getWebhooksByPublicKey(webhook.publicKey);
        for (const hook of hooks) {
          await deliverWebhook(hook, payload);
        }
      },
      onerror: (err) => {
        logger.error(JSON.stringify({ type: "horizon_sse_error", publicKey: webhook.publicKey, error: err.message }));
        activeStreams.delete(webhook.publicKey);
      },
    });

  activeStreams.set(webhook.publicKey, closeStream);
  logger.info(JSON.stringify({ type: "horizon_monitoring_started", publicKey: webhook.publicKey }));
}

module.exports = { registerWebhook, getWebhooksByPublicKey, deleteWebhook };

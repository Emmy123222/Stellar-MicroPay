"use strict";

const crypto = require("crypto");
const { sanitizeWebhookUrl } = require("./webhookUrl");

const webhooks = new Map();
const RETRY_DELAYS_MS = [250, 500, 1000];

function register({ url, publicKey, secret }) {
  if (!url || !publicKey || !secret) {
    const error = new Error("url, publicKey, and secret are required");
    error.status = 400;
    throw error;
  }

  const safeUrl = sanitizeWebhookUrl(url);

  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const error = new Error("publicKey must be a valid Stellar public key");
    error.status = 400;
    throw error;
  }

  const webhook = { id: crypto.randomUUID(), url: safeUrl, publicKey, secret, createdAt: new Date().toISOString() };
  webhooks.set(webhook.id, webhook);
  return { id: webhook.id, url: webhook.url, publicKey: webhook.publicKey, createdAt: webhook.createdAt };
}

function remove(id) {
  return webhooks.delete(id);
}

function signature(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function deliver(webhook, payload, fetchImpl = fetch) {
  const body = JSON.stringify(payload);
  const target = sanitizeWebhookUrl(webhook.url);
  let lastError;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetchImpl(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stellar-micropay-signature": signature(webhook.secret, body),
        },
        body,
      });
      if (response.ok) return;
      lastError = new Error(`Webhook responded with ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < RETRY_DELAYS_MS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}

async function publishPayment(payment, fetchImpl = fetch) {
  const deliveries = [];
  for (const webhook of webhooks.values()) {
    if (webhook.publicKey !== payment.senderPublicKey && webhook.publicKey !== payment.creatorPublicKey) continue;
    const direction = webhook.publicKey === payment.senderPublicKey ? "sent" : "received";
    deliveries.push(deliver(webhook, { type: `payment.${direction}`, direction, payment }, fetchImpl));
  }
  return Promise.allSettled(deliveries);
}

function clear() { webhooks.clear(); }

module.exports = {
  register,
  remove,
  deliver,
  publishPayment,
  signature,
  sanitizeWebhookUrl,
  clear,
  RETRY_DELAYS_MS,
};

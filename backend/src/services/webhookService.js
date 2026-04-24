/**
 * src/services/webhookService.js
 * Webhook management and Stellar payment monitoring service.
 */

"use strict";

const crypto = require("crypto");
const axios = require("axios");
const EventSource = require("eventsource");

// In-memory storage
const webhooks = new Map(); // id -> webhook object
const webhooksByPublicKey = new Map(); // publicKey -> Set of webhook IDs
const activeStreams = new Map(); // publicKey -> EventSource instance

/**
 * Generate UUID v4
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Register a new webhook
 */
function registerWebhook(publicKey, url, secret) {
  const webhook = {
    id: generateUUID(),
    publicKey,
    url,
    secret,
    createdAt: new Date().toISOString()
  };

  // Store webhook
  webhooks.set(webhook.id, webhook);

  // Add to public key index
  if (!webhooksByPublicKey.has(publicKey)) {
    webhooksByPublicKey.set(publicKey, new Set());
  }
  webhooksByPublicKey.get(publicKey).add(webhook.id);

  // Start monitoring if not already active
  if (!activeStreams.has(publicKey)) {
    startStellarMonitoring(publicKey);
  }

  return webhook;
}

/**
 * Get all webhooks for a public key
 */
function getWebhooksByPublicKey(publicKey) {
  const webhookIds = webhooksByPublicKey.get(publicKey);
  if (!webhookIds) {
    return [];
  }

  return Array.from(webhookIds)
    .map(id => webhooks.get(id))
    .filter(Boolean);
}

/**
 * Delete a webhook by ID
 */
function deleteWebhook(id) {
  const webhook = webhooks.get(id);
  if (!webhook) {
    return false;
  }

  const { publicKey } = webhook;

  // Remove from storage
  webhooks.delete(id);

  // Remove from public key index
  const publicKeyWebhooks = webhooksByPublicKey.get(publicKey);
  if (publicKeyWebhooks) {
    publicKeyWebhooks.delete(id);

    // If no more webhooks for this public key, stop monitoring
    if (publicKeyWebhooks.size === 0) {
      webhooksByPublicKey.delete(publicKey);
      stopStellarMonitoring(publicKey);
    }
  }

  return true;
}

/**
 * Start Stellar SSE monitoring for a public key
 */
function startStellarMonitoring(publicKey) {
  const url = `https://horizon-testnet.stellar.org/accounts/${publicKey}/payments?cursor=now`;
  
  console.log(`Starting Stellar monitoring for ${publicKey}`);
  
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const payment = JSON.parse(event.data);
      
      // Check if this is a payment TO the monitored public key
      if (payment.to === publicKey) {
        console.log(`Payment received for ${publicKey}:`, {
          amount: payment.amount,
          asset: payment.asset_type,
          from: payment.from
        });
        
        deliverWebhooks(publicKey, payment);
      }
    } catch (error) {
      console.error(`Error processing payment event for ${publicKey}:`, error);
    }
  };

  eventSource.onerror = (error) => {
    console.error(`SSE error for ${publicKey}:`, error);
    
    // Attempt to reconnect after a delay
    setTimeout(() => {
      if (webhooksByPublicKey.has(publicKey)) {
        console.log(`Reconnecting SSE for ${publicKey}`);
        stopStellarMonitoring(publicKey);
        startStellarMonitoring(publicKey);
      }
    }, 5000);
  };

  activeStreams.set(publicKey, eventSource);
}

/**
 * Stop Stellar SSE monitoring for a public key
 */
function stopStellarMonitoring(publicKey) {
  const eventSource = activeStreams.get(publicKey);
  if (eventSource) {
    console.log(`Stopping Stellar monitoring for ${publicKey}`);
    eventSource.close();
    activeStreams.delete(publicKey);
  }
}

/**
 * Deliver webhooks for a payment event
 */
async function deliverWebhooks(publicKey, payment) {
  const webhookList = getWebhooksByPublicKey(publicKey);
  
  if (webhookList.length === 0) {
    return;
  }

  const payload = {
    id: generateUUID(),
    type: "payment",
    publicKey,
    amount: payment.amount,
    asset: payment.asset_type === "native" ? "XLM" : payment.asset_code || payment.asset_type,
    from: payment.from,
    to: payment.to,
    timestamp: new Date().toISOString()
  };

  // Deliver to all webhooks for this public key
  const deliveryPromises = webhookList.map(webhook => 
    deliverWebhook(webhook, payload)
  );

  await Promise.allSettled(deliveryPromises);
}

/**
 * Deliver a single webhook
 */
async function deliverWebhook(webhook, payload) {
  try {
    const payloadString = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", webhook.secret)
      .update(payloadString)
      .digest("hex");

    const response = await axios.post(webhook.url, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": `sha256=${signature}`
      },
      timeout: 10000 // 10 second timeout
    });

    console.log(`Webhook delivered successfully to ${webhook.url} (${response.status})`);
  } catch (error) {
    const status = error.response?.status || "network_error";
    console.error(`Webhook delivery failed for ${webhook.id} to ${webhook.url}: ${status}`, error.message);
  }
}

/**
 * Cleanup function for graceful shutdown
 */
function cleanup() {
  console.log("Cleaning up webhook service...");
  for (const [publicKey, eventSource] of activeStreams) {
    eventSource.close();
  }
  activeStreams.clear();
}

// Handle process termination
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

module.exports = {
  registerWebhook,
  getWebhooksByPublicKey,
  deleteWebhook,
  cleanup
};
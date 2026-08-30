/**
 * src/services/webhookDelivery.js
 * Delivers a signed POST notification to a registered webhook URL.
 * Failures are logged but never thrown — the monitor must not crash.
 */

"use strict";

const dns = require("node:dns").promises;

const logger = require("../utils/logger");
const { generateWebhookSignature } = require("../utils/webhookSignature");

const BLOCKED_IPV4 = [
  [/^0\./, "unspecified"],
  [/^10\./, "private"],
  [/^127\./, "loopback"],
  [/^169\.254\./, "link-local"],
  [/^192\.0\.0\./, "special-use"],
  [/^192\.168\./, "private"],
  [/^198\.18\./, "benchmark"],
  [/^198\.19\./, "benchmark"],
  [/^224\./, "multicast"],
  [/^255\./, "broadcast"],
];

function isBlockedAddress(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return "non-public IPv6";
  }
  if (normalized.startsWith("::ffff:")) return isBlockedAddress(normalized.slice(7));
  for (const [pattern, reason] of BLOCKED_IPV4) if (pattern.test(normalized)) return reason;
  const octets = normalized.split(".").map(Number);
  if (octets.length === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return "carrier-grade NAT";
  if (octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return "private";
  return null;
}

async function validateWebhookUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error("Webhook URL is invalid"); }
  if (parsed.protocol !== "https:") throw new Error("Webhook URL must use HTTPS");
  if (parsed.username || parsed.password || parsed.port && parsed.port !== "443") throw new Error("Webhook URL has disallowed authority components");
  const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error("Webhook hostname has no address");
  for (const record of records) {
    const reason = isBlockedAddress(record.address);
    if (reason) throw new Error(`Webhook hostname resolves to a blocked ${reason} address`);
  }
  return parsed;
}

/**
 * @typedef {Object} Webhook
 * @property {string} id
 * @property {string} publicKey
 * @property {string} url
 * @property {string} secret
 * @property {string} createdAt
 */

/**
 * @typedef {Object} PaymentPayload
 * @property {string} eventId
 * @property {number} attempt
 * @property {string} createdAt
 * @property {string} network
 * @property {'payment_received'} event
 * @property {string} publicKey
 * @property {string} amount
 * @property {string} asset          - 'native' or 'CODE:ISSUER'
 * @property {string} from           - sender's public key
 * @property {string} transactionHash
 * @property {number} ledger
 * @property {string} timestamp
 */

/**
 * Deliver a webhook notification.
 * Signs the body with HMAC-SHA256 and POSTs to webhook.url.
 * Non-2xx responses and network errors are logged, never re-thrown.
 *
 * @param {Webhook} webhook
 * @param {PaymentPayload} payload
 * @returns {Promise<void>}
 */
async function deliverWebhook(webhook, payload) {
  const body = JSON.stringify(payload);
  const sig = generateWebhookSignature(body, webhook.secret);

  try {
    let url = webhook.url;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const parsed = await validateWebhookUrl(url);
      const res = await fetch(parsed, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "X-Stellar-Signature": `sha256=${sig}`,
          "X-Webhook-ID": webhook.id,
        },
        body,
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (redirects === 3) throw new Error("Webhook redirect limit exceeded");
        url = new URL(res.headers.get("location"), parsed).href;
        continue;
      }

      if (!res.ok) {
        logger.error(
          { webhookId: webhook.id, url, status: res.status },
          `[webhook] delivery failed for ${webhook.id}: HTTP ${res.status}`
        );
      }
      break;
    }
  } catch (err) {
    logger.error(
      { webhookId: webhook.id, url: webhook.url, err },
      `[webhook] delivery failed for ${webhook.id}: ${err.message}`
    );
    // Do NOT rethrow — callers use Promise.allSettled and the monitor must not crash
  }
}

module.exports = { deliverWebhook, isBlockedAddress, validateWebhookUrl };

/**
 * src/services/webhookDelivery.js
 * Delivers a signed POST notification to a registered webhook URL.
 * Never throws — returns a structured result so the delivery queue (#770)
 * can decide between retry, dead-letter, and success.
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
 * Per-attempt HTTP timeout. Bounds how long a slow receiver can occupy a
 * queue worker slot (#770).
 */
const DELIVERY_TIMEOUT_MS = parseTimeoutMs(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS);

/**
 * @param {string|undefined} raw
 * @returns {number}
 */
function parseTimeoutMs(raw) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10_000;
  return parsed;
}

/**
 * @typedef {Object} DeliveryResult
 * @property {boolean} ok              - true when the receiver answered 2xx
 * @property {number|null} httpStatus  - receiver HTTP status, null on network errors
 * @property {string|null} error       - failure reason, null on success
 */

/**
 * Deliver a webhook notification.
 * Signs the body with HMAC-SHA256 and POSTs to webhook.url.
 * Non-2xx responses and network errors are logged and reported in the
 * returned result — this function never rejects.
 *
 * @param {Webhook} webhook
 * @param {PaymentPayload} payload
 * @returns {Promise<DeliveryResult>}
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
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
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
      return { ok: false, httpStatus: res.status, error: `HTTP ${res.status}` };
    }

    logger.debug(
      { webhookId: webhook.id, url: webhook.url, status: res.status },
      `[webhook] delivered for ${webhook.id}: HTTP ${res.status}`
    );
    return { ok: true, httpStatus: res.status, error: null };
  } catch (err) {
    logger.error(
      { webhookId: webhook.id, url: webhook.url, err },
      `[webhook] delivery failed for ${webhook.id}: ${err.message}`
    );
    // Do NOT rethrow — the delivery queue treats a rejection as a failed attempt
    return { ok: false, httpStatus: null, error: err?.message ?? String(err) };
  }
}

module.exports = { deliverWebhook, isBlockedAddress, validateWebhookUrl };

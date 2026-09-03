/**
 * src/services/webhookDelivery.js
 * Delivers a signed POST notification to a registered webhook URL.
 * Failures are logged but never thrown — the monitor must not crash.
 *
 * Delivery is deliberately bounded so an attacker-controlled (or simply
 * unresponsive) webhook endpoint cannot exhaust backend resources or hang the
 * monitor. Four boundaries are enforced (see DEFAULT_LIMITS):
 *   - connectTimeoutMs : max time to reach the endpoint and receive the first
 *                        response headers.
 *   - totalTimeoutMs   : hard cap over the whole delivery, including the body
 *                        read and any redirects that are followed.
 *   - maxRedirects     : max number of HTTP redirects we will follow.
 *   - maxResponseBytes : max number of response body bytes we will read.
 *
 * Any delivery that breaches a boundary is aborted immediately and classified
 * as an over-limit error (WebhookResourceLimitError). The caller receives a
 * structured outcome so the abort can be recorded, and network/over-limit
 * errors are logged but never re-thrown.
 */

"use strict";

const dns = require("node:dns").promises;

const {
  webhookDeliveriesTotal,
  webhookDeliveryDuration,
  webhookDeliveryErrorsTotal,
} = require("../metrics/registry");
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
 * Error raised when a delivery breaches a configured resource boundary.
 * Carries a stable `code` so the abort can be classified explicitly:
 *   "connect_timeout" | "total_timeout" | "too_many_redirects" | "response_too_large"
 */
class WebhookResourceLimitError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {number} limit the limit that was breached
   */
  constructor(message, code, limit) {
    super(message);
    this.name = "WebhookResourceLimitError";
    this.code = code;
    this.limit = limit;
    /** Always true — marks this error as an over-limit abort. */
    this.overLimit = true;
  }
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
function resolveLimits(overrides = {}) {
  return {
    connectTimeoutMs:
      overrides.connectTimeoutMs ?? DEFAULT_LIMITS.connectTimeoutMs,
    totalTimeoutMs: overrides.totalTimeoutMs ?? DEFAULT_LIMITS.totalTimeoutMs,
    maxRedirects: overrides.maxRedirects ?? DEFAULT_LIMITS.maxRedirects,
    maxResponseBytes:
      overrides.maxResponseBytes ?? DEFAULT_LIMITS.maxResponseBytes,
  };
}

/**
 * Issue a single bounded HTTP(S) request (redirects are NOT followed here —
 * the caller resolves redirect chains against maxRedirects).
 *
 * Resolves with `{ status, headers, body }` where `body` is a Buffer whose
 * size never exceeds `limits.maxResponseBytes`. Rejects with a
 * WebhookResourceLimitError on connect/total timeout or on an oversized body.
 *
 * @param {string} url
 * @param {{ method: string, headers: object, body?: string, limits: typeof DEFAULT_LIMITS, signal?: AbortSignal }} options
 * @returns {Promise<{ status: number, headers: object, body: Buffer }>}
 */
function requestOnce(url, { method, headers, body, limits, signal }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    let connectTimer = null;
    let onTotalAbort = null;
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (onTotalAbort && signal) signal.removeEventListener("abort", onTotalAbort);
      fn(arg);
    };

    const totalTimeoutError = () =>
      new WebhookResourceLimitError(
        "webhook total delivery time exceeded.",
        "total_timeout",
        limits.totalTimeoutMs
      );

    const req = transport.request(parsed, { method, headers }, (res) => {
      // Response headers received — the connect phase is complete.
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }

      const chunks = [];
      let received = 0;

      res.on("data", (chunk) => {
        received += chunk.length;
        if (received > limits.maxResponseBytes) {
          const err = new WebhookResourceLimitError(
            "webhook response exceeded maximum allowed size.",
            "response_too_large",
            limits.maxResponseBytes
          );
          finish(reject, err);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () =>
        finish(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      );
      res.on("error", (err) => finish(reject, err));
    });

    // Connect timeout: fires if response headers have not arrived in time.
    connectTimer = setTimeout(() => {
      const err = new WebhookResourceLimitError(
        "webhook connection timed out.",
        "connect_timeout",
        limits.connectTimeoutMs
      );
      req.destroy(err);
    }, limits.connectTimeoutMs);

    // Total timeout: aborts the request once the overall deadline passes.
    onTotalAbort = () => req.destroy(totalTimeoutError());
    signal?.addEventListener("abort", onTotalAbort, { once: true });

    req.on("error", (err) => finish(reject, err));

    if (body != null) req.write(body);
    req.end();
  });
}

/**
 * Deliver a webhook notification.
 * Signs the body with HMAC-SHA256 and POSTs to webhook.url, bounding the
 * request with connect/total timeouts, a redirect cap and a response-size cap.
 *
 * Never throws. Returns a structured outcome so the result — including
 * over-limit aborts — can be recorded by the caller.
 *
 * @param {import('./webhookStore').Webhook} webhook
 * @param {import('./paymentMonitor').PaymentPayload} payload
 * @param {{ limits?: Partial<typeof DEFAULT_LIMITS> }} [options]
 * @returns {Promise<{ ok: boolean, status: number|null, error: object|null }>}
 */
async function deliverWebhook(webhook, payload, options = {}) {
  const limits = resolveLimits(options.limits);
  const body = JSON.stringify(payload);
  const sig = generateWebhookSignature(body, webhook.secret);
  const start = process.hrtime.bigint();

  const totalController = new AbortController();
  const totalTimer = setTimeout(
    () => totalController.abort(),
    limits.totalTimeoutMs
  );

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

      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      webhookDeliveryDuration.observe(durationSec);
      webhookDeliveriesTotal.inc({ status: String(res.status) });

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
    const code = err && err.code;
    logger.error(
      { webhookId: webhook.id, url: webhook.url, code, err: err },
      `[webhook] delivery failed for ${webhook.id}: ${err.message}`
    );
    return {
      ok: false,
      status: null,
      error: {
        code: code || "network_error",
        message: err.message || "webhook delivery failed",
        overLimit: Boolean(err && err.overLimit),
      },
    };
  } finally {
    clearTimeout(totalTimer);
  }
}

module.exports = { deliverWebhook, isBlockedAddress, validateWebhookUrl };
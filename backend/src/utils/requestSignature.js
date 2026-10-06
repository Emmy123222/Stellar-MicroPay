/**
 * src/utils/requestSignature.js
 * HMAC request signing for replay protection.
 *
 * A signed request carries two headers:
 *   X-Timestamp  — milliseconds since the Unix epoch, as a decimal string
 *   X-Signature  — lowercase hex HMAC-SHA256 over the canonical string
 *
 * The canonical string binds every part of the request that identifies *what*
 * is being asked, so none of it can be swapped in transit:
 *
 *     <timestamp>.<METHOD>.<path>.<sha256hex(body)>
 *
 * Binding the body hash is what makes this useful rather than decorative: with
 * only a timestamp in the signed material an attacker could replay a captured
 * signature against a *different* amount.
 *
 * Scope, stated plainly: this defends against replay and in-transit tampering
 * by an attacker who can observe traffic but not the signing secret. It is not
 * a substitute for authorisation. A secret shipped in a browser bundle is
 * readable by anyone who loads the page, so a per-user secret (the model the
 * webhook endpoints already use) is the stronger design whenever the caller
 * can be identified.
 */

"use strict";

const crypto = require("crypto");

/** Header names carrying the signature. */
const TIMESTAMP_HEADER = "x-timestamp";
const SIGNATURE_HEADER = "x-signature";

/**
 * Maximum accepted clock skew, in milliseconds.
 *
 * Requests older than this are rejected, which bounds how long a captured
 * request stays replayable. Clock skew between the client and this server is
 * tolerated up to the same bound in *both* directions, so a client whose clock
 * runs fast is not locked out.
 */
const DEFAULT_MAX_SKEW_MS = 30_000;

/**
 * Shared secret. Overridable so the signer (tests, other services) and the
 * verifier always agree on which key is in play.
 */
const DEFAULT_SECRET = "stellar_micropay_request_signing_key";

/**
 * @returns {string} the configured signing secret.
 */
function getSigningSecret() {
  return process.env.PAYMENT_SIGNING_SECRET || DEFAULT_SECRET;
}

/**
 * SHA-256 of the raw request body, hex encoded.
 *
 * An absent or empty body hashes the empty string, so a GET and a POST with no
 * body produce the same digest — the timestamp and method still bind them.
 *
 * @param {string|Buffer|undefined} body
 * @returns {string} hex digest
 */
function hashBody(body) {
  const buf =
    body === undefined || body === null
      ? Buffer.alloc(0)
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(String(body), "utf8");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Build the canonical string that gets signed.
 *
 * @param {{timestamp: string|number, method: string, path: string, body?: string|Buffer}} parts
 * @returns {string}
 */
function canonicalString({ timestamp, method, path, body }) {
  return [
    String(timestamp),
    String(method || "").toUpperCase(),
    String(path || ""),
    hashBody(body),
  ].join(".");
}

/**
 * Produce the signature for a request.
 *
 * @param {{timestamp: string|number, method: string, path: string, body?: string|Buffer}} parts
 * @param {string} [secret]
 * @returns {string} lowercase hex HMAC-SHA256
 */
function generateRequestSignature(parts, secret = getSigningSecret()) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("A non-empty signing secret is required");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(canonicalString(parts))
    .digest("hex");
}

/**
 * Constant-time hex comparison.
 *
 * `timingSafeEqual` throws when the two buffers differ in length, so length is
 * checked first and short-circuited. Length is not secret-dependent, so this
 * leaks nothing about the expected signature.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompareHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const bufA = Buffer.from(a.toLowerCase(), "hex");
  const bufB = Buffer.from(b.toLowerCase(), "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Check a timestamp against the freshness window.
 *
 * @param {string|number} timestamp
 * @param {number} [now] current epoch ms — injected by tests
 * @param {number} [maxSkewMs]
 * @returns {{ok: true, timestamp: number} | {ok: false, reason: string, code: string}}
 */
function checkTimestamp(timestamp, now = Date.now(), maxSkewMs = DEFAULT_MAX_SKEW_MS) {
  const raw = String(timestamp ?? "").trim();

  if (!raw) {
    return { ok: false, reason: "Missing X-Timestamp header", code: "missing_signature" };
  }

  // Reject anything that is not a plain integer. `parseInt` would happily read
  // the leading digits of "123abc", and `Number` would accept "1e9", Infinity and
  // whitespace — none of which a well-behaved client sends.
  if (!/^\d{1,15}$/.test(raw)) {
    return { ok: false, reason: "Invalid X-Timestamp header", code: "invalid_signature" };
  }

  const ts = Number(raw);
  if (!Number.isSafeInteger(ts)) {
    return { ok: false, reason: "Invalid X-Timestamp header", code: "invalid_signature" };
  }

  const age = now - ts;
  if (age > maxSkewMs) {
    return {
      ok: false,
      reason: "Request timestamp outside the accepted window",
      code: "expired_signature",
    };
  }
  if (age < -maxSkewMs) {
    // Signed far enough in the future that the client clock is wrong, or the
    // value was tampered with to stretch the window.
    return {
      ok: false,
      reason: "Request timestamp is too far in the future",
      code: "invalid_signature",
    };
  }

  return { ok: true, timestamp: ts };
}

/**
 * Full verification of a signed request.
 *
 * @param {{timestamp: string|number, signature: string, method: string, path: string, body?: string|Buffer}} parts
 * @param {{secret?: string, now?: number, maxSkewMs?: number}} [options]
 * @returns {{ok: true, timestamp: number} | {ok: false, reason: string, code: string}}
 */
function verifyRequestSignature(parts, options = {}) {
  const { secret = getSigningSecret(), now = Date.now(), maxSkewMs = DEFAULT_MAX_SKEW_MS } = options;

  const timestampCheck = checkTimestamp(parts.timestamp, now, maxSkewMs);
  if (!timestampCheck.ok) return timestampCheck;

  if (typeof parts.signature !== "string" || parts.signature.trim().length === 0) {
    return { ok: false, reason: "Missing X-Signature header", code: "missing_signature" };
  }

  const expected = generateRequestSignature(
    { timestamp: parts.timestamp, method: parts.method, path: parts.path, body: parts.body },
    secret
  );

  if (!safeCompareHex(expected, parts.signature.trim())) {
    return { ok: false, reason: "Invalid request signature", code: "invalid_signature" };
  }

  return { ok: true, timestamp: timestampCheck.timestamp };
}

module.exports = {
  TIMESTAMP_HEADER,
  SIGNATURE_HEADER,
  DEFAULT_MAX_SKEW_MS,
  getSigningSecret,
  hashBody,
  canonicalString,
  generateRequestSignature,
  verifyRequestSignature,
  checkTimestamp,
};

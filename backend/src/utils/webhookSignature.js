const crypto = require("crypto");

/**
 * Generates an HMAC-SHA256 signature for a webhook payload.
 *
 * @param {Object|string} payload - The webhook payload (will be stringified if it's an object).
 * @param {string} secret - The user's registered secret used to sign the payload.
 * @returns {string} The hex representation of the HMAC signature.
 */
function generateWebhookSignature(payload, secret) {
  const hmac = crypto.createHmac("sha256", secret);
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  hmac.update(data);
  return hmac.digest("hex");
}

/**
 * Verifies if a given signature matches the generated signature for a payload.
 *
 * @param {Object|string} payload - The webhook payload.
 * @param {string} secret - The user's registered secret.
 * @param {string} signature - The signature to verify against.
 * @returns {boolean} True if the signature is valid, false otherwise.
 */
function verifyWebhookSignature(payload, secret, signature) {
  // Reject anything that isn't a usable secret/signature before doing crypto.
  if (typeof signature !== "string" || signature.length === 0) {
    return false;
  }
  if (typeof secret !== "string" || secret.length === 0) {
    return false;
  }

  const expectedSignature = generateWebhookSignature(payload, secret);
  const expectedBuf = Buffer.from(expectedSignature, "hex");
  const providedBuf = Buffer.from(signature, "hex");

  // timingSafeEqual throws on length mismatch; a length difference already means
  // the signatures don't match, so short-circuit to false. Comparing lengths is
  // not secret-dependent, so this leaks no timing information about the secret.
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

module.exports = {
  generateWebhookSignature,
  verifyWebhookSignature,
};

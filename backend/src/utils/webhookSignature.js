const crypto = require('crypto');

/**
 * Generates an HMAC-SHA256 signature for a webhook payload.
 *
 * @param {Object|string} payload - The webhook payload (will be stringified if it's an object).
 * @param {string} secret - The user's registered secret used to sign the payload.
 * @returns {string} The hex representation of the HMAC signature.
 */
function generateWebhookSignature(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  hmac.update(data);
  return hmac.digest('hex');
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
  const expectedSignature = generateWebhookSignature(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

module.exports = {
  generateWebhookSignature,
  verifyWebhookSignature
};

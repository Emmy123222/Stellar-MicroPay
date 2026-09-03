"use strict";

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function keyFrom(value, name) {
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must be a base64-encoded 32-byte key`);
  }
  return key;
}

function configuredKeys() {
  const current = keyFrom(process.env.SCHEDULED_TX_ENCRYPTION_KEY, "SCHEDULED_TX_ENCRYPTION_KEY");
  const previous = keyFrom(process.env.SCHEDULED_TX_ENCRYPTION_KEY_PREVIOUS, "SCHEDULED_TX_ENCRYPTION_KEY_PREVIOUS");
  if (!current && process.env.NODE_ENV === "production") {
    throw new Error("SCHEDULED_TX_ENCRYPTION_KEY is required in production");
  }
  // Development fallback prevents plaintext persistence while making local setup easy.
  return { current: current || crypto.createHash("sha256").update("stellar-micropay-development-key").digest(), previous };
}

function encrypt(value) {
  const { current } = configuredKeys();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, current, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

function decrypt(payload) {
  const parts = String(payload).split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Invalid encrypted scheduled transaction");
  const [, ivText, tagText, ciphertextText] = parts;
  const { current, previous } = configuredKeys();
  for (const key of [current, previous].filter(Boolean)) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivText, "base64"));
      decipher.setAuthTag(Buffer.from(tagText, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64")), decipher.final()]).toString("utf8");
    } catch (_) {
      // Try the previous rotation key before failing.
    }
  }
  throw new Error("Unable to decrypt scheduled transaction");
}

module.exports = { encrypt, decrypt };

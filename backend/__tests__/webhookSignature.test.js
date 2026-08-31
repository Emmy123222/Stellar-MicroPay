/**
 * Edge-case coverage for webhook HMAC signature generation and verification.
 */
"use strict";

const crypto = require("crypto");
const {
  generateWebhookSignature,
  verifyWebhookSignature,
} = require("../src/utils/webhookSignature");

const SECRET = "supersecret-webhook-key";
const PAYLOAD = {
  eventId: "12345",
  attempt: 1,
  createdAt: "2026-08-27T10:00:00Z",
  network: "testnet",
  event: "payment.received",
  amount: "10.5",
  asset: "XLM"
};

function sign(payload, secret) {
  return generateWebhookSignature(payload, secret);
}

describe("generateWebhookSignature", () => {
  it("produces a 64-char hex string (SHA-256)", () => {
    const sig = sign(PAYLOAD, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs", () => {
    expect(sign(PAYLOAD, SECRET)).toBe(sign(PAYLOAD, SECRET));
  });

  it("treats a stringified object and the raw string identically", () => {
    const asString = JSON.stringify(PAYLOAD);
    expect(sign(PAYLOAD, SECRET)).toBe(sign(asString, SECRET));
  });

  it("changes when the secret changes", () => {
    expect(sign(PAYLOAD, SECRET)).not.toBe(sign(PAYLOAD, "different-secret"));
  });

  it("changes when the payload changes", () => {
    const tampered = { ...PAYLOAD, amount: "999" };
    expect(sign(PAYLOAD, SECRET)).not.toBe(sign(tampered, SECRET));
  });

  it("is sensitive to object key ordering (JSON.stringify preserves insertion order)", () => {
    const a = { x: 1, y: 2 };
    const b = { y: 2, x: 1 };
    expect(sign(a, SECRET)).not.toBe(sign(b, SECRET));
  });
});

describe("verifyWebhookSignature — valid cases", () => {
  it("accepts a correct signature for an object payload", () => {
    const sig = sign(PAYLOAD, SECRET);
    expect(verifyWebhookSignature(PAYLOAD, SECRET, sig)).toBe(true);
  });

  it("accepts a correct signature for a string payload", () => {
    const raw = JSON.stringify(PAYLOAD);
    const sig = sign(raw, SECRET);
    expect(verifyWebhookSignature(raw, SECRET, sig)).toBe(true);
  });

  it("accepts an empty-object payload with the matching signature", () => {
    const sig = sign({}, SECRET);
    expect(verifyWebhookSignature({}, SECRET, sig)).toBe(true);
  });
});

describe("verifyWebhookSignature — rejection cases", () => {
  it("rejects a tampered payload", () => {
    const sig = sign(PAYLOAD, SECRET);
    const tampered = { ...PAYLOAD, amount: "1000000" };
    expect(verifyWebhookSignature(tampered, SECRET, sig)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const sig = sign(PAYLOAD, "attacker-secret");
    expect(verifyWebhookSignature(PAYLOAD, SECRET, sig)).toBe(false);
  });

  it("rejects a valid-length but incorrect signature", () => {
    const wrong = "a".repeat(64);
    expect(verifyWebhookSignature(PAYLOAD, SECRET, wrong)).toBe(false);
  });

  it("rejects a signature that differs by a single flipped hex char", () => {
    const sig = sign(PAYLOAD, SECRET);
    const flipped =
      (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(verifyWebhookSignature(PAYLOAD, SECRET, flipped)).toBe(false);
  });
});

describe("verifyWebhookSignature — malformed input must not throw", () => {
  it("returns false (not throw) for a too-short signature", () => {
    expect(() => verifyWebhookSignature(PAYLOAD, SECRET, "abcd")).not.toThrow();
    expect(verifyWebhookSignature(PAYLOAD, SECRET, "abcd")).toBe(false);
  });

  it("returns false for a too-long signature", () => {
    const sig = sign(PAYLOAD, SECRET) + "deadbeef";
    expect(verifyWebhookSignature(PAYLOAD, SECRET, sig)).toBe(false);
  });

  it("returns false for a non-hex signature of the right length", () => {
    const notHex = "z".repeat(64);
    expect(() => verifyWebhookSignature(PAYLOAD, SECRET, notHex)).not.toThrow();
    expect(verifyWebhookSignature(PAYLOAD, SECRET, notHex)).toBe(false);
  });

  it("returns false for an odd-length hex signature", () => {
    expect(verifyWebhookSignature(PAYLOAD, SECRET, "abc")).toBe(false);
  });

  it("returns false for an empty-string signature", () => {
    expect(verifyWebhookSignature(PAYLOAD, SECRET, "")).toBe(false);
  });

  it("returns false when the signature is undefined or null", () => {
    expect(verifyWebhookSignature(PAYLOAD, SECRET, undefined)).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, SECRET, null)).toBe(false);
  });

  it("returns false when the secret is missing", () => {
    const sig = sign(PAYLOAD, SECRET);
    expect(verifyWebhookSignature(PAYLOAD, "", sig)).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, undefined, sig)).toBe(false);
  });
});

describe("verifyWebhookSignature — timing safety", () => {
  it("uses a constant-time comparison for equal-length signatures", () => {
    const spy = jest.spyOn(crypto, "timingSafeEqual");
    const sig = sign(PAYLOAD, SECRET);
    verifyWebhookSignature(PAYLOAD, SECRET, sig);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not call timingSafeEqual on a length mismatch (avoids throw)", () => {
    const spy = jest.spyOn(crypto, "timingSafeEqual");
    verifyWebhookSignature(PAYLOAD, SECRET, "abcd");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

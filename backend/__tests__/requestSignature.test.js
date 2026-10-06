/**
 * X-Timestamp / X-Signature replay protection.
 *
 * Covers the three cases the signature scheme exists for: a correctly signed
 * request is accepted, a stale one is refused, and a tampered one is refused.
 */
"use strict";

const express = require("express");
const request = require("supertest");

const {
  generateRequestSignature,
  verifyRequestSignature,
  canonicalString,
  hashBody,
  checkTimestamp,
  DEFAULT_MAX_SKEW_MS,
} = require("../src/utils/requestSignature");
const { requireSignedRequest } = require("../src/middleware/requestSignature");
const paymentController = require("../src/controllers/paymentController");

const SECRET = "test-signing-secret";
const NOW = 1_750_000_000_000;

const SENDER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const RECIPIENT = "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV";

const TX_HASH = "a".repeat(64);

/** Body as it is serialised on the wire — the signature covers these exact bytes. */
const BODY = {
  senderPublicKey: SENDER,
  recipientPublicKey: RECIPIENT,
  amount: "12.5000000",
  asset: "XLM",
  txHash: TX_HASH,
};
const BODY_STRING = JSON.stringify(BODY);

function sign({ timestamp = NOW, method = "POST", path = "/api/payments/submit", body = BODY_STRING } = {}) {
  return generateRequestSignature({ timestamp, method, path, body }, SECRET);
}

function app() {
  const server = express();
  // Mirrors server.js: the signature is verified over the raw bytes received.
  server.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    })
  );
  // The real controller, so the tests exercise the actual route wiring rather
  // than a stub that would accept anything the middleware lets through.
  server.post("/api/payments/submit", requireSignedRequest, paymentController.submitPayment);
  return server;
}

/** Post with an explicit signature so tests can send deliberately bad ones. */
function post(headers, body = BODY) {
  return request(app()).post("/api/payments/submit").set(headers).send(body);
}

beforeEach(() => {
  delete process.env.PAYMENT_SIGNING_SECRET;
});

describe("canonical string", () => {
  it("binds timestamp, method, path and body", () => {
    const canonical = canonicalString({
      timestamp: 123,
      method: "post",
      path: "/api/payments/submit",
      body: "hi",
    });
    expect(canonical).toBe(`123.POST./api/payments/submit.${hashBody("hi")}`);
  });

  it("produces a different signature for a different body", () => {
    const a = sign({ body: JSON.stringify({ amount: "1" }) });
    const b = sign({ body: JSON.stringify({ amount: "2" }) });
    expect(a).not.toBe(b);
  });

  it("normalises the method case so post and POST agree", () => {
    expect(sign({ method: "post" })).toBe(sign({ method: "POST" }));
  });

  it("treats an absent body as the empty string", () => {
    expect(hashBody(undefined)).toBe(hashBody(""));
  });
});

describe("timestamp window", () => {
  it("accepts a timestamp inside the window", () => {
    expect(checkTimestamp(NOW, NOW).ok).toBe(true);
  });

  it("accepts one at the boundary", () => {
    expect(checkTimestamp(NOW - DEFAULT_MAX_SKEW_MS, NOW).ok).toBe(true);
  });

  it("rejects one just past the boundary as expired", () => {
    const result = checkTimestamp(NOW - DEFAULT_MAX_SKEW_MS - 1, NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("expired_signature");
  });

  it("rejects a timestamp far in the future", () => {
    const result = checkTimestamp(NOW + DEFAULT_MAX_SKEW_MS + 1, NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_signature");
  });

  it.each([
    ["non-numeric", "not-a-number"],
    ["trailing junk", `${NOW}abc`],
    ["scientific notation", "1e12"],
    ["negative", "-1"],
    ["decimal", `${NOW}.5`],
    ["hex", "0x1"],
    ["empty", ""],
  ])("rejects a %s timestamp", (_label, value) => {
    // parseInt would accept "…abc"; Number would accept "1e12". Neither may pass.
    expect(checkTimestamp(value, NOW).ok).toBe(false);
  });
});

describe("verifyRequestSignature", () => {
  const base = { method: "POST", path: "/api/payments/submit", body: BODY_STRING };

  it("accepts a correctly signed, fresh request", () => {
    const signature = generateRequestSignature({ ...base, timestamp: NOW }, SECRET);
    const result = verifyRequestSignature(
      { ...base, timestamp: NOW, signature },
      { secret: SECRET, now: NOW }
    );
    expect(result.ok).toBe(true);
    expect(result.timestamp).toBe(NOW);
  });

  it("rejects a missing signature", () => {
    const result = verifyRequestSignature({ ...base, timestamp: NOW, signature: "" }, { secret: SECRET, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("missing_signature");
  });

  it("rejects a signature made with the wrong secret", () => {
    const signature = generateRequestSignature({ ...base, timestamp: NOW }, "some-other-secret");
    const result = verifyRequestSignature({ ...base, timestamp: NOW, signature }, { secret: SECRET, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_signature");
  });

  it("rejects a non-hex signature of the right length", () => {
    const result = verifyRequestSignature(
      { ...base, timestamp: NOW, signature: "z".repeat(64) },
      { secret: SECRET, now: NOW }
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an expired signature before comparing digests", () => {
    const old = NOW - DEFAULT_MAX_SKEW_MS - 1;
    const signature = generateRequestSignature({ ...base, timestamp: old }, SECRET);
    const result = verifyRequestSignature({ ...base, timestamp: old, signature }, { secret: SECRET, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("expired_signature");
  });
});

describe("POST /api/payments/submit", () => {
  describe("valid signature", () => {
    it("accepts a correctly signed request", async () => {
      process.env.PAYMENT_SIGNING_SECRET = SECRET;
      const timestamp = Date.now();
      const signature = generateRequestSignature(
        { timestamp, method: "POST", path: "/api/payments/submit", body: BODY_STRING },
        SECRET
      );

      const res = await post({ "X-Timestamp": timestamp, "X-Signature": signature });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it("accepts a request signed with the built-in default secret when no env secret is set", async () => {
      const timestamp = Date.now();
      const signature = generateRequestSignature(
        { timestamp, method: "POST", path: "/api/payments/submit", body: BODY_STRING },
        undefined // falls back to the module default on both sides
      );

      const res = await post({ "X-Timestamp": timestamp, "X-Signature": signature });
      expect(res.status).toBe(201);
    });
  });

  describe("expired signature", () => {
    it("rejects a request older than the 30s window with 401", async () => {
      process.env.PAYMENT_SIGNING_SECRET = SECRET;
      const timestamp = Date.now() - DEFAULT_MAX_SKEW_MS - 5_000;
      const signature = generateRequestSignature(
        { timestamp, method: "POST", path: "/api/payments/submit", body: BODY_STRING },
        SECRET
      );

      const res = await post({ "X-Timestamp": timestamp, "X-Signature": signature });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("expired_signature");
    });

    it("rejects a correctly signed request that is just over the window", async () => {
      process.env.PAYMENT_SIGNING_SECRET = SECRET;
      const timestamp = Date.now() - DEFAULT_MAX_SKEW_MS - 1;
      const signature = generateRequestSignature(
        { timestamp, method: "POST", path: "/api/payments/submit", body: BODY_STRING },
        SECRET
      );

      const res = await post({ "X-Timestamp": timestamp, "X-Signature": signature });
      expect(res.status).toBe(401);
    });
  });

  describe("missing signature", () => {
    it("rejects a request with no headers at all", async () => {
      const res = await post({});
      expect(res.status).toBe(401);
      expect(res.body.code).toMatch(/missing_signature/);
    });

    it("rejects a request with a timestamp but no signature", async () => {
      const res = await post({ "X-Timestamp": Date.now() });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("missing_signature");
    });

    it("rejects a request with a signature but no timestamp", async () => {
      const res = await post({ "X-Signature": "a".repeat(64) });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("missing_signature");
    });
  });

  describe("tampered signature", () => {
    it("rejects a body modified after signing (amount changed)", async () => {
      process.env.PAYMENT_SIGNING_SECRET = SECRET;
      const timestamp = Date.now();
      const signature = generateRequestSignature(
        { timestamp, method: "POST", path: "/api/payments/submit", body: BODY_STRING },
        SECRET
      );

      const tampered = { ...BODY, amount: "9999.0000000" };
      const res = await post({ "X-Timestamp": timestamp, "X-Signature": signature }, tampered);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("invalid_signature");
    });

    it("rejects an extra field added after signing", async () => {
      process.env.PAYMENT_SIGNING_SECRET = SECRET;
      const timestamp = Date.now();
      const signature = generateRequestSignature(
        { timestamp, method: "POST", path: "/api/payments/submit", body: BODY_STRING },
        SECRET
      );

      const res = await post(
        { "X-Timestamp": timestamp, "X-Signature": signature },
        { ...BODY, memo: "smuggled" }
      );
      expect(res.status).toBe(401);
    });

    it("rejects a replayed signature against a different path", async () => {
      process.env.PAYMENT_SIGNING_SECRET = SECRET;
      const timestamp = Date.now();
      const signature = generateRequestSignature(
        { timestamp, method: "POST", path: "/api/other", body: BODY_STRING },
        SECRET
      );

      const res = await post({ "X-Timestamp": timestamp, "X-Signature": signature });
      expect(res.status).toBe(401);
    });

    it("rejects a signature carrying a different timestamp than the header", async () => {
      process.env.PAYMENT_SIGNING_SECRET = SECRET;
      const realNow = Date.now();
      const stale = realNow - 20_000;
      const signature = generateRequestSignature(
        // Signed over `stale`…
        { timestamp: stale, method: "POST", path: "/api/payments/submit", body: BODY_STRING },
        SECRET
      );

      // …but sent with a fresh timestamp, trying to keep the request alive.
      const res = await post({ "X-Timestamp": realNow, "X-Signature": signature });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("invalid_signature");
    });

    it("rejects a signature that is a valid signature with one hex char flipped", async () => {
      process.env.PAYMENT_SIGNING_SECRET = SECRET;
      const timestamp = Date.now();
      const signature = generateRequestSignature(
        { timestamp, method: "POST", path: "/api/payments/submit", body: BODY_STRING },
        SECRET
      );

      const flipped = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
      const res = await post({ "X-Timestamp": timestamp, "X-Signature": flipped });
      expect(res.status).toBe(401);
    });
  });

  describe("body validation (after a valid signature)", () => {
    async function signedPost(body) {
      process.env.PAYMENT_SIGNING_SECRET = SECRET;
      const timestamp = Date.now();
      const bodyString = JSON.stringify(body);
      const signature = generateRequestSignature(
        { timestamp, method: "POST", path: "/api/payments/submit", body: bodyString },
        SECRET
      );
      return post({ "X-Timestamp": timestamp, "X-Signature": signature }, body);
    }

    it("rejects an invalid sender public key with 400", async () => {
      const res = await signedPost({ ...BODY, senderPublicKey: "NOT_A_KEY" });
      expect(res.status).toBe(400);
    });

    it("rejects a non-positive amount with 400", async () => {
      const res = await signedPost({ ...BODY, amount: "0" });
      expect(res.status).toBe(400);
    });

    it("rejects self-payment with 400", async () => {
      const res = await signedPost({ ...BODY, recipientPublicKey: SENDER });
      expect(res.status).toBe(400);
    });

    it("rejects a malformed txHash with 400", async () => {
      const res = await signedPost({ ...BODY, txHash: "deadbeef" });
      expect(res.status).toBe(400);
    });
  });
});

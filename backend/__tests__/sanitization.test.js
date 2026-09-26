/**
 * __tests__/sanitization.test.js
 * Unit tests for the Stellar public key sanitization middleware.
 */

"use strict";

const { sanitizePublicKey, sanitizePublicKeyParam } = require("../src/middleware/sanitization");

const VALID_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Minimal Express-like req/res/next triple.
 */
function mockExchange(params) {
  const req = { params, headers: {} };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("sanitization", () => {
  describe("sanitizePublicKey (:publicKey)", () => {
    it("accepts a valid Stellar public key", () => {
      const { req, res, next } = mockExchange({ publicKey: VALID_KEY });

      sanitizePublicKey(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    it("rejects a key that is too short", () => {
      const { req, res, next } = mockExchange({ publicKey: "GABC" });

      sanitizePublicKey(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "Invalid Stellar public key format" });
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects a secret key starting with S", () => {
      const secret = `S${VALID_KEY.slice(1)}`;
      const { req, res, next } = mockExchange({ publicKey: secret });

      sanitizePublicKey(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects a 56 character value that does not start with G", () => {
      const { req, res, next } = mockExchange({ publicKey: "A".repeat(56) });

      sanitizePublicKey(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it("strips non-alphanumeric characters before validating", () => {
      const { req, res, next } = mockExchange({ publicKey: VALID_KEY });

      req.params.publicKey = ` ${VALID_KEY} `;
      sanitizePublicKey(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.params.publicKey).toBe(VALID_KEY);
    });

    it("calls next without validating when the param is absent", () => {
      const { req, res, next } = mockExchange({});

      sanitizePublicKey(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });
  });

  describe("sanitizePublicKeyParam (named params)", () => {
    it("validates and writes back a :creatorPublicKey param", () => {
      const { req, res, next } = mockExchange({ creatorPublicKey: VALID_KEY });
      const middleware = sanitizePublicKeyParam("creatorPublicKey");

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.params.creatorPublicKey).toBe(VALID_KEY);
    });

    it("rejects an invalid :creatorPublicKey instead of silently passing", () => {
      const { req, res, next } = mockExchange({ creatorPublicKey: "not-a-key" });
      const middleware = sanitizePublicKeyParam("creatorPublicKey");

      middleware(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "Invalid Stellar public key format" });
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects an invalid :senderPublicKey", () => {
      const { req, res, next } = mockExchange({ senderPublicKey: "SHORT" });
      const middleware = sanitizePublicKeyParam("senderPublicKey");

      middleware(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it("ignores a different param name rather than reading it", () => {
      // The regression that motivated this factory: a middleware bound to
      // "publicKey" used on a route whose param is "creatorPublicKey" found
      // nothing and passed the unvalidated value straight through.
      const { req, res, next } = mockExchange({ creatorPublicKey: "bad-key" });
      const middleware = sanitizePublicKeyParam("publicKey");

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    it("rejects an array-valued param without throwing", () => {
      const { req, res, next } = mockExchange({ publicKey: [VALID_KEY, VALID_KEY] });

      sanitizePublicKey(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

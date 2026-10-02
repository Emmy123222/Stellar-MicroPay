/**
 * __tests__/publicKeyRoutes.test.js
 * Integration tests asserting that every route accepting a Stellar public key
 * in its path actually validates it.
 */

"use strict";

const request = require("supertest");
// The rate limiter keeps a process-global store shared by every spec
// file, so lift the cap here rather than have unrelated specs
// exhaust each other's budget.
process.env.RATE_LIMIT_MAX = "10000";
process.env.STRICT_RATE_LIMIT_MAX = "10000";

const app = require("../src/server");

const VALID_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("Public key validation on key-bearing routes", () => {
  describe("GET /api/tips/received/:creatorPublicKey", () => {
    it("rejects a malformed creator public key", async () => {
      const response = await request(app)
        .get("/api/tips/received/not-a-valid-key")
        .expect(400);

      expect(response.body).toHaveProperty(
        "error",
        "Invalid Stellar public key format"
      );
    });

    it("rejects a secret key", async () => {
      const secret = `S${VALID_KEY.slice(1)}`;
      const response = await request(app)
        .get(`/api/tips/received/${secret}`)
        .expect(400);

      expect(response.body).toHaveProperty(
        "error",
        "Invalid Stellar public key format"
      );
    });

    it("accepts a valid creator public key", async () => {
      const response = await request(app)
        .get(`/api/tips/received/${VALID_KEY}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });
  });

  describe("GET /api/tips/stats/:creatorPublicKey", () => {
    it("rejects a malformed creator public key", async () => {
      const response = await request(app)
        .get("/api/tips/stats/nope")
        .expect(400);

      expect(response.body).toHaveProperty(
        "error",
        "Invalid Stellar public key format"
      );
    });

    it("accepts a valid creator public key", async () => {
      const response = await request(app)
        .get(`/api/tips/stats/${VALID_KEY}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });
  });

  describe("GET /api/tips/sent/:senderPublicKey", () => {
    it("rejects a malformed sender public key", async () => {
      const response = await request(app)
        .get("/api/tips/sent/nope")
        .expect(400);

      expect(response.body).toHaveProperty(
        "error",
        "Invalid Stellar public key format"
      );
    });

    it("accepts a valid sender public key", async () => {
      const response = await request(app)
        .get(`/api/tips/sent/${VALID_KEY}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });
  });

  describe("GET /api/payments/:publicKey/stats", () => {
    it("rejects a malformed public key", async () => {
      const response = await request(app)
        .get("/api/payments/not-a-valid-key/stats")
        .expect(400);

      expect(response.body).toHaveProperty(
        "error",
        "Invalid Stellar public key format"
      );
    });
  });

  describe("GET /api/accounts/:publicKey", () => {
    it("rejects a malformed public key", async () => {
      const response = await request(app)
        .get("/api/accounts/nope")
        .expect(400);

      expect(response.body).toHaveProperty(
        "error",
        "Invalid Stellar public key format"
      );
    });
  });
});

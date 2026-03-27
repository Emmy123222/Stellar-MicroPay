/**
 * __tests__/federation.test.js
 * Integration tests for federation endpoints per SEP-0002.
 */

"use strict";

const request = require("supertest");
const app = require("../src/server");
const usernameService = require("../src/services/usernameService");

describe("Federation API", () => {
  const testUsername = "testuser";
  const testPublicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  beforeAll(async () => {
    // Register a test user
    try {
      usernameService.registerUsername(testUsername, testPublicKey);
    } catch (err) {
      // User might already exist
    }
  });

  afterAll(async () => {
    // Clean up
    try {
      usernameService.removeUsername(testUsername);
    } catch (err) {
      // User might not exist
    }
  });

  describe("GET /.well-known/stellar.toml", () => {
    it("should return valid TOML with FEDERATION_SERVER", async () => {
      const response = await request(app)
        .get("/.well-known/stellar.toml")
        .expect(200)
        .expect("Content-Type", /application\/toml/);

      expect(response.text).toContain("[FEDERATION_SERVER]");
      expect(response.text).toContain("ACTIVE = true");
      expect(response.text).toContain("SERVER =");
    });
  });

  describe("GET /federation", () => {
    describe("type=name", () => {
      it("should resolve a local stellar address", async () => {
        const stellarAddress = `${testUsername}*stellarmicropay.com`;

        const response = await request(app)
          .get("/federation")
          .query({ q: stellarAddress, type: "name" })
          .expect(200);

        expect(response.body).toHaveProperty("stellar_address", stellarAddress);
        expect(response.body).toHaveProperty("account_id", testPublicKey);
      });

      it("should return 404 for non-existent username", async () => {
        const stellarAddress = "nonexistent*stellarmicropay.com";

        const response = await request(app)
          .get("/federation")
          .query({ q: stellarAddress, type: "name" })
          .expect(404);

        expect(response.body).toHaveProperty("error", "Username not found");
      });

      it("should return 400 for invalid stellar address format", async () => {
        const invalidAddress = "invalidaddress";

        const response = await request(app)
          .get("/federation")
          .query({ q: invalidAddress, type: "name" })
          .expect(400);

        expect(response.body).toHaveProperty("error");
      });
    });

    describe("type=id", () => {
      it("should resolve a local account ID", async () => {
        const response = await request(app)
          .get("/federation")
          .query({ q: testPublicKey, type: "id" })
          .expect(200);

        expect(response.body).toHaveProperty("stellar_address", `${testUsername}*stellarmicropay.com`);
      });

      it("should return 404 for non-existent account ID", async () => {
        const unknownPublicKey = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

        const response = await request(app)
          .get("/federation")
          .query({ q: unknownPublicKey, type: "id" })
          .expect(404);

        expect(response.body).toHaveProperty("error", "Account ID not found");
      });
    });

    it("should return 400 for missing parameters", async () => {
      const response = await request(app)
        .get("/federation")
        .expect(400);

      expect(response.body).toHaveProperty("error", "Missing required parameters: q and type");
    });

    it("should return 400 for invalid type", async () => {
      const response = await request(app)
        .get("/federation")
        .query({ q: "test", type: "invalid" })
        .expect(400);

      expect(response.body).toHaveProperty("error", "Invalid type parameter. Must be 'name' or 'id'");
    });
  });
});
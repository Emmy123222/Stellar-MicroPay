/**
 * __tests__/webhooks.test.js
 * Tests for webhook functionality
 */

const request = require("supertest");
const app = require("../server");

describe("Webhook API", () => {
  const validPublicKey = "GCKFBEIYTKP6JY4Q2UZKBQJLGR2HKFOQNPZGFR5HKXQXQXQXQXQXQXQX";
  const validWebhookData = {
    publicKey: validPublicKey,
    url: "https://example.com/webhook",
    secret: "test-secret-123"
  };

  describe("POST /api/webhooks", () => {
    it("should register a new webhook", async () => {
      const response = await request(app)
        .post("/api/webhooks")
        .send(validWebhookData)
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.publicKey).toBe(validPublicKey);
      expect(response.body.url).toBe(validWebhookData.url);
      expect(response.body).toHaveProperty("createdAt");
      expect(response.body).not.toHaveProperty("secret");
    });

    it("should reject invalid public key", async () => {
      const invalidData = { ...validWebhookData, publicKey: "invalid-key" };
      
      await request(app)
        .post("/api/webhooks")
        .send(invalidData)
        .expect(400);
    });

    it("should reject missing fields", async () => {
      const incompleteData = { publicKey: validPublicKey };
      
      await request(app)
        .post("/api/webhooks")
        .send(incompleteData)
        .expect(400);
    });

    it("should reject invalid URL", async () => {
      const invalidData = { ...validWebhookData, url: "not-a-url" };
      
      await request(app)
        .post("/api/webhooks")
        .send(invalidData)
        .expect(400);
    });
  });

  describe("GET /api/webhooks/:publicKey", () => {
    it("should return empty array for public key with no webhooks", async () => {
      const response = await request(app)
        .get(`/api/webhooks/${validPublicKey}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it("should reject invalid public key format", async () => {
      await request(app)
        .get("/api/webhooks/invalid-key")
        .expect(400);
    });
  });

  describe("DELETE /api/webhooks/:id", () => {
    it("should return 404 for non-existent webhook", async () => {
      await request(app)
        .delete("/api/webhooks/non-existent-id")
        .expect(404);
    });
  });
});
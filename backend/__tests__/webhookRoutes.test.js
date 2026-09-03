/**
 * Webhook registration HTTP routes.
 */
"use strict";

jest.mock("../src/services/webhookService", () => {
  const store = new Map();
  let nextId = 1;

  return {
    registerWebhook: jest.fn((publicKey, url, secret) => {
      const webhook = {
        id: String(nextId++),
        publicKey,
        url,
        secret,
        createdAt: new Date().toISOString(),
      };
      store.set(webhook.id, webhook);
      return webhook;
    }),
    getWebhooksByPublicKey: jest.fn((publicKey) =>
      Array.from(store.values()).filter((w) => w.publicKey === publicKey)
    ),
    deleteWebhook: jest.fn((id) => store.delete(id)),
  };
});

jest.mock("../src/middleware/rateLimit", () => ({
  strictLimiter: (req, res, next) => next(),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  StrKey: {
    isValidEd25519PublicKey: () => true,
  },
}));

const express = require("express");
const request = require("supertest");
const webhookRoutes = require("../src/routes/webhooks");
const webhookService = require("../src/services/webhookService");

const ME = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api/webhooks", webhookRoutes);
  return server;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/webhooks", () => {
  it("requires publicKey, url, and secret", async () => {
    const res = await request(app()).post("/api/webhooks").send({ url: "https://x.test/h" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("registers a webhook", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .send({ publicKey: ME, url: "https://x.test/hook", secret: "supersecret" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.webhook.publicKey).toBe(ME);
    expect(webhookService.registerWebhook).toHaveBeenCalledWith(
      ME,
      "https://x.test/hook",
      "supersecret"
    );
  });
});

describe("GET /api/webhooks/:publicKey", () => {
  it("returns webhooks for the account", async () => {
    webhookService.getWebhooksByPublicKey.mockReturnValue([
      { id: "1", publicKey: ME, url: "https://x.test/hook", secret: "supersecret" },
    ]);

    const res = await request(app()).get(`/api/webhooks/${ME}`);
    expect(res.status).toBe(200);
    expect(res.body.webhooks).toHaveLength(1);
  });
});

describe("DELETE /api/webhooks/:id", () => {
  it("deletes an existing webhook", async () => {
    webhookService.deleteWebhook.mockReturnValue(true);

    const res = await request(app()).delete("/api/webhooks/1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 when the webhook does not exist", async () => {
    webhookService.deleteWebhook.mockReturnValue(false);

    const res = await request(app()).delete("/api/webhooks/missing");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Webhook not found");
  });
});

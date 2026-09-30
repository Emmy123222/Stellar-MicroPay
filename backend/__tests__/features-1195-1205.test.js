"use strict";

const request = require("supertest");
const crypto = require("crypto");
const app = require("../src/server");
const tips = require("../src/services/tipsService");
const webhooks = require("../src/services/webhookService");

const SENDER = `G${"A".repeat(55)}`;
const RECIPIENT = `G${"B".repeat(55)}`;

afterEach(() => webhooks.clear());

test("echoes an incoming request ID and generates one when absent", async () => {
  const supplied = await request(app).get("/health").set("X-Request-ID", "trace-123");
  expect(supplied.headers["x-request-id"]).toBe("trace-123");
  const generated = await request(app).get("/health");
  expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
});

test("registers and removes a webhook without exposing its secret", async () => {
  const created = await request(app).post("/api/webhooks/register").send({ url: "https://example.com/hook", publicKey: SENDER, secret: "private" }).expect(201);
  expect(created.body.data).not.toHaveProperty("secret");
  await request(app).delete(`/api/webhooks/${created.body.data.id}`).expect(204);
  await request(app).delete(`/api/webhooks/${created.body.data.id}`).expect(404);
});

test("signs webhook bodies using HMAC-SHA256", () => {
  const body = JSON.stringify({ event: "payment.sent" });
  expect(webhooks.signature("secret", body)).toBe(crypto.createHmac("sha256", "secret").update(body).digest("hex"));
});

test("returns ranked XLM senders and recipients", async () => {
  tips.recordTip({ senderPublicKey: SENDER, creatorPublicKey: RECIPIENT, amount: "2.5" });
  const response = await request(app).get("/api/tips/leaderboard").expect(200);
  expect(response.body.data.recipients[0]).toEqual({ publicKey: RECIPIENT, federationName: null, totalXLM: "2.5000000" });
  expect(response.body.data.senders[0]).toEqual({ publicKey: SENDER, federationName: null, totalXLM: "2.5000000" });
  expect(response.body.data.totalTips).toBeGreaterThanOrEqual(1);
});

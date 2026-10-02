/**
 * __tests__/idempotency.test.js
 * Integration tests for the payment-submission idempotency layer.
 */

"use strict";

const request = require("supertest");

jest.mock("../src/services/stellarService", () => ({
  submitTransaction: jest.fn(),
  getAccount: jest.fn(),
  getXLMBalance: jest.fn(),
  getPayments: jest.fn(),
}));

const app = require("../src/server");
const stellarService = require("../src/services/stellarService");
const idempotencyService = require("../src/services/idempotencyService");

const SUBMIT_PATH = "/api/payments/submit";
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("POST /api/payments/submit idempotency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    idempotencyService.clear();
    stellarService.submitTransaction.mockResolvedValue({
      hash: "abc123hash",
      ledger: 42,
      successful: true,
    });
  });

  it("accepts the X-Idempotency-Key header and returns 200", async () => {
    const res = await request(app)
      .post(SUBMIT_PATH)
      .set("X-Idempotency-Key", UUID)
      .send({ signedXDR: "AAAA...signed" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { hash: "abc123hash", ledger: 42, successful: true },
    });
    expect(stellarService.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns the cached response for duplicate requests within 24h", async () => {
    const first = await request(app)
      .post(SUBMIT_PATH)
      .set("X-Idempotency-Key", UUID)
      .send({ signedXDR: "AAAA...signed" });

    const second = await request(app)
      .post(SUBMIT_PATH)
      .set("X-Idempotency-Key", UUID)
      .send({ signedXDR: "AAAA...signed" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.status).not.toBe(409);
    expect(second.body).toEqual(first.body);
    expect(second.headers["x-idempotency-replayed"]).toBe("true");
    // The payment is submitted only once despite two requests.
    expect(stellarService.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("treats different keys as distinct submissions", async () => {
    await request(app)
      .post(SUBMIT_PATH)
      .set("X-Idempotency-Key", UUID)
      .send({ signedXDR: "AAAA...signed" });

    await request(app)
      .post(SUBMIT_PATH)
      .set("X-Idempotency-Key", "b3c1a2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d")
      .send({ signedXDR: "AAAA...signed" });

    expect(stellarService.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it("still works without an idempotency key", async () => {
    const res = await request(app)
      .post(SUBMIT_PATH)
      .send({ signedXDR: "AAAA...signed" });

    expect(res.status).toBe(200);
    expect(stellarService.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed idempotency key", async () => {
    const res = await request(app)
      .post(SUBMIT_PATH)
      .set("X-Idempotency-Key", "not-a-uuid")
      .send({ signedXDR: "AAAA...signed" });

    expect(res.status).toBe(400);
    expect(stellarService.submitTransaction).not.toHaveBeenCalled();
  });

  it("does not cache failed submissions", async () => {
    const failed = new Error("Transaction failed");
    failed.status = 400;
    stellarService.submitTransaction.mockRejectedValueOnce(failed);

    const first = await request(app)
      .post(SUBMIT_PATH)
      .set("X-Idempotency-Key", UUID)
      .send({ signedXDR: "AAAA...signed" });

    expect(first.status).toBe(400);

    const second = await request(app)
      .post(SUBMIT_PATH)
      .set("X-Idempotency-Key", UUID)
      .send({ signedXDR: "AAAA...signed" });

    expect(second.status).toBe(200);
    expect(stellarService.submitTransaction).toHaveBeenCalledTimes(2);
  });
});

describe("idempotencyService", () => {
  beforeEach(() => idempotencyService.clear());

  it("expires cached responses after the TTL", () => {
    idempotencyService.set(UUID, { status: 200, body: { ok: true } }, 0);
    expect(idempotencyService.get(UUID)).toBeNull();
  });
});

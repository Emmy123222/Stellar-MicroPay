/**
 * __tests__/streamStatusRoutes.test.js
 * #1066 — GET /api/payments/stream-status/:streamId route wiring:
 * response shape, 404 mapping, validation errors, and rate limiting.
 */
"use strict";

// Set JWT_SECRET before any middleware imports
process.env.JWT_SECRET = "test-secret-key-for-jest-tests-only-not-for-production";

const express = require("express");
const request = require("supertest");
jest.mock("../src/services/streamService");

const streamService = require("../src/services/streamService");
// Automock strips constructor field assignments, so take the real error classes
// (they carry the .status the error handler maps to HTTP codes).
const {
  StreamNotFoundError,
  ContractNotConfiguredError,
} = jest.requireActual("../src/services/streamService");

const paymentRoutes = require("../src/routes/payments");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/payments", paymentRoutes);
  app.use((err, req, res, next) => {
    void next;
    const status = err.status || 500;
    res.status(status).json({ error: err.message || "Internal Server Error" });
  });
  return app;
}

describe("GET /api/payments/stream-status/:streamId (#1066)", () => {
  const app = buildApp();

  beforeEach(() => {
    // Ensure JWT_SECRET is set before any module imports (auth middleware
    // requires it at module load time)
    process.env.JWT_SECRET = "test-secret-key-for-jest-tests-only-not-for-production";
    jest.clearAllMocks();
  });

  it("returns 200 with the stream state payload", async () => {
    streamService.getStreamStatus.mockResolvedValue({
      payer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
      recipient: "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX",
      ratePerLedger: "10",
      deposited: "1000",
      claimed: "40",
      startLedger: 100,
      claimableNow: "60",
    });

    const res = await request(app).get("/api/payments/stream-status/1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        payer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
        recipient: "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX",
        ratePerLedger: "10",
        deposited: "1000",
        claimed: "40",
        startLedger: 100,
        claimableNow: "60",
      },
    });
    expect(streamService.getStreamStatus).toHaveBeenCalledWith("1");
  });

  it("returns 404 when the stream id does not exist", async () => {
    streamService.getStreamStatus.mockRejectedValue(new StreamNotFoundError("42"));

    const res = await request(app).get("/api/payments/stream-status/42");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Stream 42 not found" });
  });

  it("returns 503 when CONTRACT_ID is not configured", async () => {
    streamService.getStreamStatus.mockRejectedValue(new ContractNotConfiguredError());

    const res = await request(app).get("/api/payments/stream-status/1");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/CONTRACT_ID/);
  });

  it("returns 400 for a malformed stream id", async () => {
    const bad = new Error("streamId must be an unsigned 32-bit integer");
    bad.status = 400;
    streamService.getStreamStatus.mockRejectedValue(bad);

    const res = await request(app).get("/api/payments/stream-status/abc");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "streamId must be an unsigned 32-bit integer" });
  });

  it("propagates unexpected RPC failures as 500", async () => {
    streamService.getStreamStatus.mockRejectedValue(new Error("ECONNRESET"));

    const res = await request(app).get("/api/payments/stream-status/1");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "ECONNRESET" });
  });

  it("is rate limited with the route limiter (429 after exhaustion)", async () => {
    // Re-require the router so the test gets a fresh module-level limiter store
    // (the limiter singleton is shared by earlier requests in this suite).
    jest.resetModules();
    const freshRoutes = require("../src/routes/payments");
    const freshService = require("../src/services/streamService");
    freshService.getStreamStatus.mockResolvedValue({
      payer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
      recipient: null,
      ratePerLedger: "1",
      deposited: "1",
      claimed: "0",
      startLedger: 1,
      claimableNow: "1",
    });

    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use("/api/payments", freshRoutes);
    freshApp.use((err, req, res, next) => {
      void next;
      res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
    });

    // strictLimiter allows 20/min — exhaust it and expect 429.
    for (let i = 0; i < 20; i++) {
      const res = await request(freshApp).get("/api/payments/stream-status/1");
      expect(res.status).toBe(200);
    }
    const limited = await request(freshApp).get("/api/payments/stream-status/1");
    expect(limited.status).toBe(429);
  });

  it("documents the path and schema in the committed swagger spec", () => {
    const spec = require("../src/swagger");

    const op = spec.paths["/api/payments/stream-status/{streamId}"];
    expect(op).toBeDefined();
    expect(op.get.summary).toMatch(/streaming payment channel/i);
    expect(spec.components.schemas.StreamStatus).toBeDefined();
    expect(Object.keys(spec.components.schemas.StreamStatus.properties).sort()).toEqual(
      [
        "claimableNow",
        "claimed",
        "deposited",
        "payer",
        "ratePerLedger",
        "recipient",
        "startLedger",
      ].sort()
    );
  });
});

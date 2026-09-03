/**
 * __tests__/correlationId.test.js
 * End-to-end request correlation ID tests (#837).
 *
 * Verifies that incoming requests either accept a well-formed X-Request-Id or
 * generate a fresh valid one, that the ID is echoed back on the response
 * header, that structured logs are tagged with the ID, and that the header is
 * exposed for outbound third-party calls.
 */

"use strict";

const express = require("express");
const request = require("supertest");

jest.mock("../src/middleware/auth", () => ({
  verifyJWT: (req, res, next) => {
    req.user = { publicKey: req.params.publicKey };
    next();
  },
}));

const app = require("../src/server");
const { getCorrelationId, correlationHeaders, CORRELATION_HEADER } = require("../src/utils/logger");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("end-to-end request correlation IDs (#837)", () => {
  it("generates a valid correlation ID when none is provided and returns it in the response header", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    const id = res.headers[CORRELATION_HEADER];
    expect(id).toBeDefined();
    expect(UUID_RE.test(id)).toBe(true);
  });

  it("accepts and echoes a valid incoming X-Request-Id header", async () => {
    const incoming = "4f6c2a0e-019b-4a10-9f8d-7b1eab2c3d44";
    const res = await request(app)
      .get("/health")
      .set(CORRELATION_HEADER, incoming);
    expect(res.status).toBe(200);
    expect(res.headers[CORRELATION_HEADER]).toBe(incoming);
  });

  it("replaces an invalid incoming correlation ID with a freshly generated one", async () => {
    const bad = "not-a-valid-uuid!";
    const res = await request(app)
      .get("/health")
      .set(CORRELATION_HEADER, bad);
    expect(res.status).toBe(200);
    const id = res.headers[CORRELATION_HEADER];
    expect(id).not.toBe(bad);
    expect(UUID_RE.test(id)).toBe(true);
  });

  it("tags structured logs with the active correlation ID", async () => {
    const lines = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      lines.push(chunk.toString());
      return true;
    };

    try {
      const incoming = "7c3f4b62-40dc-4f0a-bb11-0d42f0c1a2b3";
      const res = await request(app)
        .get("/health")
        .set(CORRELATION_HEADER, incoming);
      expect(res.status).toBe(200);

      // The HTTP access log line emitted by pino-http during the request should
      // carry the correlation ID because it is still inside the async context.
      const accessLog = lines
        .map((line) => JSON.parse(line))
        .find((entry) => typeof entry.req !== "undefined" || entry.res !== undefined);
      expect(accessLog).toBeDefined();
      expect(accessLog.correlationId).toBe(incoming);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("exposes the correlation ID to code making outbound calls during a request", async () => {
    let observedInside = null;
    let observedHeaders = null;

    (async () => {
      // Simulate a request async context by running under runWithCorrelationId.
      const { runWithCorrelationId } = require("../src/utils/logger");
      runWithCorrelationId("b2a9e1f0-1c2d-4e3f-9a8b-7c6d5e4f3a21", () => {
        observedInside = getCorrelationId();
        observedHeaders = correlationHeaders();
      });
    })();

    await new Promise((resolve) => setImmediate(resolve));
    expect(observedInside).toBe("b2a9e1f0-1c2d-4e3f-9a8b-7c6d5e4f3a21");
    expect(observedHeaders[CORRELATION_HEADER]).toBe(
      "b2a9e1f0-1c2d-4e3f-9a8b-7c6d5e4f3a21"
    );
  });

  it("returns an empty header set when no correlation ID is active (detached jobs)", () => {
    // Reset any context so this runs outside a request.
    expect(getCorrelationId()).toBeNull();
    expect(correlationHeaders()).toEqual({});
  });
});
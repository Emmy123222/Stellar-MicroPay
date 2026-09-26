/**
 * __tests__/requestId.test.js
 * Tests for X-Request-ID correlation middleware.
 */

"use strict";

const request = require("supertest");
// The rate limiter keeps a process-global store shared by every spec
// file, so lift the cap here rather than have unrelated specs
// exhaust each other's budget.
process.env.RATE_LIMIT_MAX = "10000";
process.env.STRICT_RATE_LIMIT_MAX = "10000";

const app = require("../src/server");
const { resolveRequestId, HEADER_NAME } = require("../src/middleware/requestId");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("requestId", () => {
  describe("resolveRequestId", () => {
    it("generates a UUID when no header is supplied", () => {
      expect(resolveRequestId(undefined)).toMatch(UUID_RE);
    });

    it("echoes a well-formed inbound id", () => {
      expect(resolveRequestId("abc-123_XYZ:1")).toBe("abc-123_XYZ:1");
    });

    it("trims surrounding whitespace from an inbound id", () => {
      expect(resolveRequestId("  padded-id  ")).toBe("padded-id");
    });

    it("replaces an id containing a CRLF sequence", () => {
      // Guards against log injection via the echoed header value.
      const hostile = "abc\r\nGET /evil";
      expect(resolveRequestId(hostile)).toMatch(UUID_RE);
    });

    it("replaces an id containing a space or punctuation", () => {
      expect(resolveRequestId("bad id!")).toMatch(UUID_RE);
    });

    it("replaces an id containing a control character", () => {
      expect(resolveRequestId("badid")).toMatch(UUID_RE);
    });

    it("replaces an id longer than 128 characters", () => {
      expect(resolveRequestId("a".repeat(129))).toMatch(UUID_RE);
    });

    it("replaces a non-string header value", () => {
      expect(resolveRequestId(undefined)).toMatch(UUID_RE);
    });
  });

  describe("middleware integration", () => {
    it("sets X-Request-ID on a successful response", async () => {
      const response = await request(app).get("/health").expect(200);

      expect(response.headers[HEADER_NAME.toLowerCase()]).toMatch(UUID_RE);
    });

    it("echoes a client-supplied X-Request-ID", async () => {
      const response = await request(app)
        .get("/health")
        .set(HEADER_NAME, "client-correlation-id")
        .expect(200);

      expect(response.headers[HEADER_NAME.toLowerCase()]).toBe(
        "client-correlation-id"
      );
    });

    it("substitutes a generated id when the client sends a hostile value", async () => {
      const response = await request(app)
        .get("/health")
        .set(HEADER_NAME, "bad id with spaces and !@#")
        .expect(200);

      expect(response.headers[HEADER_NAME.toLowerCase()]).toMatch(UUID_RE);
    });

    it("sets X-Request-ID on a 404 response", async () => {
      const response = await request(app).get("/definitely-not-a-route").expect(404);

      expect(response.headers[HEADER_NAME.toLowerCase()]).toMatch(UUID_RE);
    });

    it("sets X-Request-ID on a rejected request", async () => {
      const response = await request(app).get("/api/accounts/nope").expect(400);

      expect(response.headers[HEADER_NAME.toLowerCase()]).toMatch(UUID_RE);
    });

    it("sets X-Request-ID on a request rejected by validation middleware", async () => {
      // sanitizePublicKey short-circuits with its own response rather than
      // delegating to the central error handler, so the correlation id is
      // carried on the response header here.
      const response = await request(app)
        .get("/api/accounts/nope")
        .set(HEADER_NAME, "trace-me-1234")
        .expect(400);

      expect(response.body).toHaveProperty("error", "Invalid Stellar public key format");
      expect(response.headers[HEADER_NAME.toLowerCase()]).toBe("trace-me-1234");
    });

    it("includes the request id in the error body for handled errors", async () => {
      const response = await request(app)
        .get("/api/tips/leaderboard?limit=abc")
        .set(HEADER_NAME, "trace-me-1234")
        .expect(400);

      expect(response.body).toHaveProperty("error", "limit must be a positive integer");
      expect(response.body).toHaveProperty("requestId", "trace-me-1234");
    });

    it("includes a generated request id in the error body", async () => {
      const response = await request(app)
        .get("/api/tips/leaderboard?limit=abc")
        .expect(400);

      expect(response.body.requestId).toMatch(UUID_RE);
    });

    it("includes the request id when the JSON body is malformed", async () => {
      const response = await request(app)
        .post("/api/tips")
        .set("Content-Type", "application/json")
        .set(HEADER_NAME, "trace-bad-json")
        .send("{ this is not json ")
        .expect(400);

      expect(response.body).toHaveProperty("error", "Invalid JSON body");
      expect(response.body).toHaveProperty("requestId", "trace-bad-json");
    });
  });
});

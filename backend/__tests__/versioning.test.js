/**
 * __tests__/versioning.test.js
 * Automated unit and integration tests for API Versioning and Deprecation Policy (#853).
 */

"use strict";

const request = require("supertest");
const app = require("../src/server");

describe("API Versioning & Deprecation Policy (#853)", () => {
  describe("Versioned endpoints (/api/v1/*)", () => {
    it("GET /api/v1/health returns 200 without deprecation headers", async () => {
      const res = await request(app).get("/api/v1/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.headers.deprecation).toBeUndefined();
      expect(res.headers.sunset).toBeUndefined();
      expect(res.headers.link).toBeUndefined();
    });

    it("GET /api/v1/accounts/resolve/bob resolves without deprecation headers", async () => {
      const res = await request(app).get("/api/v1/accounts/resolve/bob");

      expect(res.headers.deprecation).toBeUndefined();
      expect(res.headers.sunset).toBeUndefined();
    });
  });

  describe("Legacy unversioned endpoints (/api/*)", () => {
    it("GET /api/accounts/resolve/bob includes Deprecation, Sunset, and Link headers", async () => {
      const res = await request(app).get("/api/accounts/resolve/bob");

      expect(res.headers.deprecation).toBe("true");
      expect(res.headers.sunset).toBeDefined();
      expect(res.headers.link).toContain("/api/v1/accounts/resolve/bob");
      expect(res.headers.link).toContain('rel="successor-version"');
    });

    it("GET /api/analytics/overview includes Deprecation, Sunset, and Link headers", async () => {
      const res = await request(app).get("/api/analytics/overview");

      expect(res.headers.deprecation).toBe("true");
      expect(res.headers.sunset).toBeDefined();
      expect(res.headers.link).toContain("/api/v1/analytics/overview");
      expect(res.headers.link).toContain('rel="successor-version"');
    });
  });
});

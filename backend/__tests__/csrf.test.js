/**
 * __tests__/csrf.test.js
 * Tests for the double-submit cookie CSRF protection.
 */

"use strict";

const request = require("supertest");
const app = require("../src/server");
const {
  parseCookies,
  tokensMatch,
  generateCsrfToken,
  CSRF_COOKIE,
  CSRF_HEADER,
} = require("../src/middleware/csrf");

describe("CSRF protection", () => {
  describe("helpers", () => {
    it("parses a Cookie header into a map", () => {
      expect(parseCookies("a=1; b=two; c")).toEqual({ a: "1", b: "two" });
      expect(parseCookies(undefined)).toEqual({});
    });

    it("compares tokens in constant time and rejects mismatches", () => {
      expect(tokensMatch("token", "token")).toBe(true);
      expect(tokensMatch("token", "other")).toBe(false);
      expect(tokensMatch("short", "longertoken")).toBe(false);
      expect(tokensMatch(null, "token")).toBe(false);
    });

    it("generates unpredictable hex tokens", () => {
      const a = generateCsrfToken();
      const b = generateCsrfToken();
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(a).not.toEqual(b);
    });
  });

  describe("GET /api/auth/csrf", () => {
    it("issues a readable csrfToken cookie and returns the token", async () => {
      const res = await request(app).get("/api/auth/csrf").expect(200);

      expect(typeof res.body.csrfToken).toBe("string");
      expect(res.body.csrfToken).toMatch(/^[0-9a-f]{64}$/);

      const cookie = res.headers["set-cookie"].find((c) =>
        c.startsWith(`${CSRF_COOKIE}=`)
      );
      expect(cookie).toBeDefined();
      expect(cookie).toContain(res.body.csrfToken);
      // Must be readable by the frontend to echo it back.
      expect(cookie).not.toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    });
  });

  describe("state-changing requests", () => {
    it("allows stateless requests that carry no cookies", async () => {
      const res = await request(app)
        .post("/api/accounts/register")
        .send({ username: "csrf_nostat", publicKey: "G".repeat(56) });
      expect(res.status).not.toBe(403);
    });

    it("blocks a cookie-bearing request with no CSRF header", async () => {
      const res = await request(app)
        .post("/api/accounts/register")
        .set("Cookie", `${CSRF_COOKIE}=abc123`)
        .send({ username: "csrf_nohdr", publicKey: "G".repeat(56) });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/CSRF/i);
    });

    it("blocks a cookie-bearing request with a mismatched header", async () => {
      const res = await request(app)
        .post("/api/accounts/register")
        .set("Cookie", `${CSRF_COOKIE}=abc123`)
        .set(CSRF_HEADER, "wrong-token")
        .send({ username: "csrf_bad", publicKey: "G".repeat(56) });

      expect(res.status).toBe(403);
    });

    it("allows a cookie-bearing request with a matching header", async () => {
      const token = "matching-token-value";
      const res = await request(app)
        .post("/api/accounts/register")
        .set("Cookie", `${CSRF_COOKIE}=${token}`)
        .set(CSRF_HEADER, token)
        .send({ username: "csrf_ok", publicKey: "G".repeat(56) });

      expect(res.status).not.toBe(403);
    });

    it("never blocks safe methods", async () => {
      const res = await request(app)
        .get("/api/accounts/resolve/nobody")
        .set("Cookie", `${CSRF_COOKIE}=abc123`);
      expect(res.status).not.toBe(403);
    });
  });
});

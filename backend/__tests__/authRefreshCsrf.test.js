/**
 * #780 — POST /api/auth/refresh must reject cookie-authenticated requests
 * whose Origin/Referer isn't one of ALLOWED_ORIGINS, while leaving the
 * bearer-token (non-browser) flow untouched.
 */
"use strict";

const express = require("express");
const request = require("supertest");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

process.env.ALLOWED_ORIGINS = "https://app.example.com";

const { JWT_SECRET, SIGN_OPTIONS } = require("../src/middleware/auth");
const authRoutes = require("../src/routes/auth");
const tokenFamilyStore = require("../src/services/tokenFamilyStore");

const PUBLIC_KEY = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

function app() {
  const server = express();
  server.use(express.json());
  server.use(cookieParser());
  server.use("/api/auth", authRoutes);
  return server;
}

function makeToken() {
  const { familyId, jti } = tokenFamilyStore.createFamily(PUBLIC_KEY);
  return jwt.sign({ publicKey: PUBLIC_KEY, fam: familyId }, JWT_SECRET, {
    ...SIGN_OPTIONS,
    jwtid: jti,
  });
}

describe("POST /api/auth/refresh — CSRF origin check", () => {
  it("rejects a cookie-authenticated request from a disallowed origin", async () => {
    const token = makeToken();

    const res = await request(app())
      .post("/api/auth/refresh")
      .set("Cookie", `jwt=${token}`)
      .set("Origin", "https://evil.test");

    expect(res.status).toBe(403);
  });

  it("rejects a cookie-authenticated request with no Origin/Referer at all", async () => {
    const token = makeToken();

    const res = await request(app()).post("/api/auth/refresh").set("Cookie", `jwt=${token}`);

    expect(res.status).toBe(403);
  });

  it("accepts a cookie-authenticated request from an allowed origin", async () => {
    const token = makeToken();

    const res = await request(app())
      .post("/api/auth/refresh")
      .set("Cookie", `jwt=${token}`)
      .set("Origin", "https://app.example.com");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("does not require Origin for the bearer-token (non-browser) flow", async () => {
    const token = makeToken();

    const res = await request(app())
      .post("/api/auth/refresh")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

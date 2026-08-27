/**
 * #278 — account-data routes must require a SEP-10 JWT and only allow access to
 * the caller's own account.
 */
"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, SIGN_OPTIONS } = require("../src/middleware/auth");
const accountRoutes = require("../src/routes/accounts");

const ME = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const OTHER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

function appWithAccounts() {
  const app = express();
  app.use(express.json());
  app.use("/api/accounts", accountRoutes);
  return app;
}

function tokenFor(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET, SIGN_OPTIONS);
}

describe("account routes authorization (#278)", () => {
  const app = appWithAccounts();

  it("rejects an unauthenticated account request with 401", async () => {
    const res = await request(app).get(`/api/accounts/${ME}`);
    expect(res.status).toBe(401);
  });

  it("rejects accessing another account's data with 403", async () => {
    const res = await request(app)
      .get(`/api/accounts/${OTHER}`)
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    expect(res.status).toBe(403);
  });

  it("rejects the balance route without a token", async () => {
    const res = await request(app).get(`/api/accounts/${ME}/balance`);
    expect(res.status).toBe(401);
  });
});

describe("username registration wallet ownership (#755)", () => {
  const app = appWithAccounts();

  it("rejects registration without a wallet proof", async () => {
    const res = await request(app)
      .post("/api/accounts/register")
      .send({ username: "alice", publicKey: ME });
    expect(res.status).toBe(401);
  });

  it("rejects a key that differs from the authenticated wallet subject", async () => {
    const res = await request(app)
      .post("/api/accounts/register")
      .set("Authorization", `Bearer ${tokenFor(ME)}`)
      .send({ username: "alice", publicKey: OTHER });
    expect(res.status).toBe(403);
  });
});

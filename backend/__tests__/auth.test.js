"use strict";

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: { Server: jest.fn() },
  Keypair: { random: jest.fn() },
  rpc: { Server: jest.fn() },
  SorobanRpc: { Server: jest.fn() },
  Networks: { PUBLIC: "Public Global Stellar Network ; September 2015", TESTNET: "Test SDF Network ; September 2015" },
}));

const request = require("supertest");
const express = require("express");
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-for-jest-tests-only-not-for-production";
process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
process.env.HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

const jwt = require("jsonwebtoken");

const app = require("../src/server");

const { verifyJWT, JWT_SECRET } = require("../src/middleware/auth");

describe("Auth Middleware - verifyJWT", () => {
  let testApp;
  const testSecret = JWT_SECRET || process.env.JWT_SECRET || "test-secret-key-for-jest-tests-only-not-for-production";

  beforeEach(() => {
    testApp = express();
    testApp.use(express.json());

    testApp.get("/protected", verifyJWT, (req, res) => {
      res.status(200).json({ user: req.user });
    });
  });

  it("Valid JWT → req.user set correctly, next() called", async () => {
    const payload = { publicKey: "GABCDEFGHIJKLMNOPQRSTUVWXYZ" };
    const token = jwt.sign(payload, testSecret, { expiresIn: "1h" });

    const response = await request(testApp)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toBeDefined();
    expect(response.body.user.publicKey).toBe(payload.publicKey);
  });

  it("Expired JWT → 401 response", async () => {
    const payload = { publicKey: "GABCDEFGHIJKLMNOPQRSTUVWXYZ" };
    const token = jwt.sign(payload, testSecret, { expiresIn: "-1h" });

    const response = await request(testApp)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized: invalid or expired token");
  });

  it("Missing Authorization header → 401 response", async () => {
    const response = await request(testApp).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized: missing or invalid token");
  });

  it("Token signed with wrong secret → 401 response", async () => {
    const payload = { publicKey: "GABCDEFGHIJKLMNOPQRSTUVWXYZ" };
    const wrongSecret = "wrong_secret_key";
    const token = jwt.sign(payload, wrongSecret, { expiresIn: "1h" });

    const response = await request(testApp)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized: invalid or expired token");
  });
});

describe("SEP-0010 auth rate limiting", () => {
  it("blocks the sixth verification request from the same IP within a minute", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post("/api/auth").send({}).expect(400);
    }

    const response = await request(app).post("/api/auth").send({}).expect(429);

    expect(response.headers["retry-after"]).toMatch(/^\d+$/);
  });

  it("allows five challenge requests and blocks the sixth from the same IP", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).get("/api/auth").expect(400);
    }

    const response = await request(app).get("/api/auth").expect(429);

    expect(response.headers["retry-after"]).toMatch(/^\d+$/);
  });
});

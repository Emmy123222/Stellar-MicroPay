"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const accountController = require("../src/controllers/accountController");
const stellarService = require("../src/services/stellarService");
const usernameService = require("../src/services/usernameService");
const { verifyJWT, JWT_SECRET } = require("../src/middleware/auth");

jest.mock("../src/services/stellarService");
jest.mock("../src/services/usernameService");

const validPublicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const generateToken = (payload = { publicKey: validPublicKey }) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

function setupApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/accounts/resolve/:username", accountController.resolveUsername);
  app.get("/api/accounts/:publicKey/balance", accountController.getBalance);
  app.get("/api/accounts/:publicKey/streaks", accountController.getStreaks);
  app.get("/api/accounts/:publicKey/memo-history", verifyJWT, accountController.getMemoHistory);
  app.get("/api/accounts/:publicKey", accountController.getAccount);
  app.post("/api/accounts/register", accountController.registerUsername);

  app.use((err, req, res, next) => {
    void next;
    const status = err.status || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ error: message });
  });

  return app;
}

describe("accountController", () => {
  const app = setupApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/accounts/:publicKey/memo-history", () => {
    it("rejects unauthenticated requests without JWT header", async () => {
      const res = await request(app).get(`/api/accounts/${validPublicKey}/memo-history`);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("rejects requests with invalid JWT token", async () => {
      const res = await request(app)
        .get(`/api/accounts/${validPublicKey}/memo-history`)
        .set("Authorization", "Bearer invalid.jwt.token");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("returns distinct memo history when authenticated with valid JWT", async () => {
      const mockMemos = ["Coffee", "Invoice 123", "Tip for service"];
      stellarService.getMemoHistory.mockResolvedValue(mockMemos);

      const token = generateToken();
      const res = await request(app)
        .get(`/api/accounts/${validPublicKey}/memo-history`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: mockMemos,
      });
      expect(stellarService.getMemoHistory).toHaveBeenCalledWith(validPublicKey);
    });

    it("returns 400 when invalid public key is passed", async () => {
      const invalidErr = new Error("Invalid Stellar public key format");
      invalidErr.status = 400;
      stellarService.getMemoHistory.mockRejectedValue(invalidErr);

      const token = generateToken();
      const res = await request(app)
        .get("/api/accounts/INVALID_KEY/memo-history")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid Stellar public key format");
    });
  });

  describe("GET /api/accounts/:publicKey", () => {
    it("returns account info for a valid public key", async () => {
      const mockAccount = { publicKey: validPublicKey, sequence: "100", balances: [] };
      stellarService.getAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get(`/api/accounts/${validPublicKey}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: mockAccount });
    });
  });

  describe("GET /api/accounts/:publicKey/balance", () => {
    it("returns XLM balance", async () => {
      stellarService.getXLMBalance.mockResolvedValue("150.5000000");

      const res = await request(app).get(`/api/accounts/${validPublicKey}/balance`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { publicKey: validPublicKey, xlm: "150.5000000" },
      });
    });
  });

  describe("GET /api/accounts/:publicKey/streaks", () => {
    it("returns account streaks", async () => {
      const mockStreaks = { currentStreak: 5, longestStreak: 12, lastTransactionDate: "2026-03-27" };
      stellarService.getAccountStreaks.mockResolvedValue(mockStreaks);

      const res = await request(app).get(`/api/accounts/${validPublicKey}/streaks`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockStreaks);
    });
  });

  describe("POST /api/accounts/register", () => {
    it("registers a username successfully", async () => {
      usernameService.registerUsername.mockReturnValue({ username: "alice", publicKey: validPublicKey });

      const res = await request(app)
        .post("/api/accounts/register")
        .send({ username: "alice", publicKey: validPublicKey });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ username: "alice", publicKey: validPublicKey });
    });

    it("returns 400 when missing username or publicKey", async () => {
      const res = await request(app).post("/api/accounts/register").send({ username: "alice" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/accounts/resolve/:username", () => {
    it("resolves a registered username", async () => {
      usernameService.resolveUsername.mockReturnValue({ username: "alice", publicKey: validPublicKey });

      const res = await request(app).get("/api/accounts/resolve/alice");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { username: "alice", publicKey: validPublicKey },
      });
    });
  });
});

"use strict";

const express = require("express");
const request = require("supertest");
const accountController = require("../src/controllers/accountController");
const stellarService = require("../src/services/stellarService");
const usernameService = require("../src/services/usernameService");

jest.mock("../src/services/stellarService");
jest.mock("../src/services/usernameService");

function setupApp() {
  const app = express();
  app.use(express.json());
  
  // Fake auth middleware that mirrors what the real auth layer does:
  // it sets req.user.publicKey from the JWT-verified session.
  app.use((req, _res, next) => {
    // For register tests the caller passes publicKey in the body;
    // use that so the wallet-ownership check passes.
    req.user = { publicKey: req.body?.publicKey || req.params?.publicKey };
    next();
  });

  app.get("/api/accounts/resolve/:username", accountController.resolveUsername);
  app.get("/api/accounts/:publicKey/balance", accountController.getBalance);
  app.get("/api/accounts/:publicKey", accountController.getAccount);
  app.post("/api/accounts/register", accountController.registerUsername);
  
  // Standard error handler resembling the one in server.js
  app.use((err, req, res, next) => {
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

  describe("getAccount", () => {
    it("returns account info for a valid public key", async () => {
      const mockAccount = { id: "G_VALID", balances: [] };
      stellarService.getAccount.mockResolvedValue(mockAccount);

      const res = await request(app).get("/api/accounts/G_VALID");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: mockAccount
      });
      expect(stellarService.getAccount).toHaveBeenCalledWith("G_VALID");
    });

    it("returns 404 for a nonexistent account", async () => {
      const notFoundError = new Error("Account not found");
      notFoundError.status = 404;
      stellarService.getAccount.mockRejectedValue(notFoundError);

      const res = await request(app).get("/api/accounts/G_MISSING");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: "Account not found"
      });
    });

    it("propagates stellarService errors as the documented error response", async () => {
      const serverError = new Error("Stellar network error");
      serverError.status = 503; 
      stellarService.getAccount.mockRejectedValue(serverError);

      const res = await request(app).get("/api/accounts/G_ERROR");

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: "Stellar network error"
      });
    });
  });

  describe("getBalance", () => {
    it("returns balance info for a valid public key", async () => {
      stellarService.getXLMBalance.mockResolvedValue("100.00");

      const res = await request(app).get("/api/accounts/G_VALID/balance");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { publicKey: "G_VALID", xlm: "100.00" }
      });
      expect(stellarService.getXLMBalance).toHaveBeenCalledWith("G_VALID");
    });

    it("propagates errors from stellarService", async () => {
      const err = new Error("Failed to get balance");
      err.status = 400;
      stellarService.getXLMBalance.mockRejectedValue(err);

      const res = await request(app).get("/api/accounts/G_ERROR/balance");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Failed to get balance" });
    });
  });

  describe("registerUsername", () => {
    it("returns 400 if username or publicKey is missing", async () => {
      const res = await request(app).post("/api/accounts/register").send({ username: "alice" });
      
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: "Username and public key are required"
      });
    });

    it("registers a username successfully", async () => {
      usernameService.registerUsername.mockReturnValue({ username: "alice", publicKey: "G_VALID" });

      const res = await request(app)
        .post("/api/accounts/register")
        .send({ username: "alice", publicKey: "G_VALID" });
        
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        data: { username: "alice", publicKey: "G_VALID" },
        message: "Username registered successfully"
      });
      expect(usernameService.registerUsername).toHaveBeenCalledWith("alice", "G_VALID");
    });

    it("propagates errors from usernameService", async () => {
      usernameService.registerUsername.mockImplementation(() => {
        const err = new Error("Username already taken");
        err.status = 409;
        throw err; // usernameService methods appear to be synchronous in the controller
      });

      const res = await request(app)
        .post("/api/accounts/register")
        .send({ username: "bob", publicKey: "G_VALID" });
        
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "Username already taken" });
    });
  });

  describe("resolveUsername", () => {
    it("resolves a username to its associated public key", async () => {
      usernameService.resolveUsername.mockReturnValue({ publicKey: "G_VALID" });

      const res = await request(app).get("/api/accounts/resolve/bob456");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { publicKey: "G_VALID" }
      });
      expect(usernameService.resolveUsername).toHaveBeenCalledWith("bob456");
    });

    it("propagates errors when username cannot be resolved", async () => {
      usernameService.resolveUsername.mockImplementation(() => {
        const err = new Error("Username not found");
        err.status = 404;
        throw err;
      });

      const res = await request(app).get("/api/accounts/resolve/unknown");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Username not found" });
    });
  });
});

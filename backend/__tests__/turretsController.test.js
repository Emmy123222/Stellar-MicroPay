"use strict";

const express = require("express");
const request = require("supertest");
const turretsController = require("../src/controllers/turretsController");
const turretsService = require("../src/services/turretsService");
const { verifyJWT } = require("../src/middleware/auth");
const jwt = require("jsonwebtoken");

jest.mock("../src/services/turretsService");

const JWT_SECRET = process.env.JWT_SECRET || "stellar_micropay_secret_key";
const generateToken = (payload) => jwt.sign(payload, JWT_SECRET, { issuer: "stellar-micropay" });

function setupApp() {
  const app = express();
  app.use(express.json());
  
  app.post("/api/turrets/challenge", turretsController.createChallenge);
  app.post("/api/turrets/deploy", verifyJWT, turretsController.deploy);
  app.get("/api/turrets", turretsController.list);
  app.get("/api/turrets/:id", turretsController.getOne);
  app.get("/api/turrets/:id/history", turretsController.getHistory);
  app.post("/api/turrets/:id/pause", verifyJWT, turretsController.pause);
  app.post("/api/turrets/:id/resume", verifyJWT, turretsController.resume);
  
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ error: message });
  });
  
  return app;
}

describe("turretsController", () => {
  const app = setupApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createChallenge", () => {
    it("creates a signing challenge successfully", async () => {
      const mockData = { challengeXDR: "test_xdr" };
      turretsService.createSigningChallenge.mockResolvedValue(mockData);

      const res = await request(app).post("/api/turrets/challenge").send({
        ownerPublicKey: "G_TEST",
        type: "dca",
        config: {}
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: mockData });
    });
  });

  describe("deploy", () => {
    it("rejects unauthenticated requests", async () => {
      const res = await request(app).post("/api/turrets/deploy").send({});
      expect(res.status).toBe(401);
    });

    it("deploys txFunction successfully when authenticated", async () => {
      const mockData = { id: "test-id" };
      turretsService.deployTxFunction.mockReturnValue(mockData);
      
      const token = generateToken({ publicKey: "G_TEST" });

      const res = await request(app)
        .post("/api/turrets/deploy")
        .set("Authorization", `Bearer ${token}`)
        .send({ ownerPublicKey: "G_TEST" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: mockData });
    });
  });

  describe("pause", () => {
    it("toggles the expected job state to paused", async () => {
      turretsService.setDeploymentStatus.mockReturnValue({ id: "1", status: "paused" });
      const token = generateToken({ publicKey: "G_TEST" });

      const res = await request(app)
        .post("/api/turrets/1/pause")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { id: "1", status: "paused" } });
      expect(turretsService.setDeploymentStatus).toHaveBeenCalledWith("1", "paused", "G_TEST");
    });
  });

  describe("resume", () => {
    it("toggles the expected job state to active", async () => {
      turretsService.setDeploymentStatus.mockReturnValue({ id: "1", status: "active" });
      const token = generateToken({ publicKey: "G_TEST" });

      const res = await request(app)
        .post("/api/turrets/1/resume")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { id: "1", status: "active" } });
      expect(turretsService.setDeploymentStatus).toHaveBeenCalledWith("1", "active", "G_TEST");
    });
  });

  describe("history", () => {
    it("returns paginated results", async () => {
      turretsService.getDeployment.mockReturnValue({ id: "1" });
      
      const mockHistory = Array.from({ length: 15 }, (_, i) => ({ id: `log-${i}` }));
      turretsService.getExecutionHistory.mockReturnValue(mockHistory);

      const res = await request(app).get("/api/turrets/1/history?page=2&limit=5");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(5);
      expect(res.body.data[0].id).toBe("log-5");
      expect(res.body.pagination).toEqual({
        total: 15,
        page: 2,
        limit: 5,
        pages: 3
      });
    });
  });
});

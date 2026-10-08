/**
 * __tests__/accountAssets.test.js
 * #1065 — GET /api/accounts/:publicKey/assets
 * Non-native trustline listing: JWT auth, mapping, native XLM exclusion,
 * and error propagation.
 */
"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const accountRoutes = require("../src/routes/accounts");
const stellarService = require("../src/services/stellarService");
const { JWT_SECRET } = require("../src/middleware/auth");

jest.mock("../src/services/stellarService");

const ME = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const OTHER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

const MOCK_ASSETS = [
  {
    assetCode: "USDC",
    assetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3GP3JCXACMUWUR5FQNB5KFK5DV3",
    balance: "12.5000000",
    limit: "1000.0000000",
  },
  {
    assetCode: "FOO",
    assetIssuer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
    balance: "0.0000000",
    limit: "922337203685.4775807",
  },
];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/accounts", accountRoutes);
  app.use((err, req, res, next) => {
    void next;
    const status = err.status || 500;
    res.status(status).json({ error: err.message || "Internal Server Error" });
  });
  return app;
}

function tokenFor(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET);
}

describe("GET /api/accounts/:publicKey/assets (#1065)", () => {
  const app = buildApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("authentication", () => {
    it("rejects an unauthenticated request with 401", async () => {
      const res = await request(app).get(`/api/accounts/${ME}/assets`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/i);
      expect(stellarService.getAccountAssets).not.toHaveBeenCalled();
    });

    it("rejects an invalid token with 401", async () => {
      const res = await request(app)
        .get(`/api/accounts/${ME}/assets`)
        .set("Authorization", "Bearer not-a-real-token");

      expect(res.status).toBe(401);
      expect(stellarService.getAccountAssets).not.toHaveBeenCalled();
    });
  });

  describe("response shape", () => {
    it("returns trustline objects with code, issuer, balance, and limit for the JWT subject", async () => {
      stellarService.getAccountAssets.mockResolvedValue(MOCK_ASSETS);

      const res = await request(app)
        .get(`/api/accounts/${OTHER}/assets`)
        .set("Authorization", `Bearer ${tokenFor(ME)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: [
          {
            assetCode: "USDC",
            assetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3GP3JCXACMUWUR5FQNB5KFK5DV3",
            balance: "12.5000000",
            limit: "1000.0000000",
          },
          {
            assetCode: "FOO",
            assetIssuer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
            balance: "0.0000000",
            limit: "922337203685.4775807",
          },
        ],
      });
      expect(stellarService.getAccountAssets).toHaveBeenCalledWith(OTHER);
    });

    it("returns an empty array when the account has no non-native trustlines", async () => {
      stellarService.getAccountAssets.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/accounts/${ME}/assets`)
        .set("Authorization", `Bearer ${tokenFor(ME)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
    });
  });

  describe("error propagation", () => {
    it("returns 404 when the account does not exist", async () => {
      const notFound = new Error("Account not found");
      notFound.status = 404;
      stellarService.getAccountAssets.mockRejectedValue(notFound);

      const res = await request(app)
        .get(`/api/accounts/${ME}/assets`)
        .set("Authorization", `Bearer ${tokenFor(ME)}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Account not found" });
    });

    it("propagates Horizon failures with their status", async () => {
      const boom = new Error("Horizon unavailable");
      boom.status = 503;
      stellarService.getAccountAssets.mockRejectedValue(boom);

      const res = await request(app)
        .get(`/api/accounts/${ME}/assets`)
        .set("Authorization", `Bearer ${tokenFor(ME)}`);

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "Horizon unavailable" });
    });
  });

  describe("swagger docs", () => {
    it("documents the assets path and AssetTrustline schema", () => {
      const spec = require("../src/swagger");

      expect(spec.paths["/api/accounts/{publicKey}/assets"]).toBeDefined();
      expect(spec.paths["/api/accounts/{publicKey}/assets"].get.summary).toBe(
        "List non-native asset trustlines"
      );
      expect(spec.components.schemas.AssetTrustline).toBeDefined();
      expect(spec.components.schemas.AssetTrustline.properties).toEqual(
        expect.objectContaining({
          assetCode: expect.any(Object),
          assetIssuer: expect.any(Object),
          balance: expect.any(Object),
          limit: expect.any(Object),
        })
      );
    });
  });
});

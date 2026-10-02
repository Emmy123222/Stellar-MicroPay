/**
 * __tests__/hasUsdcTrustline.test.js
 * Unit test for GET /api/accounts/:publicKey/has-usdc-trustline (#1069).
 */

"use strict";

const mockLoadAccount = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      loadAccount: mockLoadAccount,
    })),
  },
}));

const stellarService = require("../src/services/stellarService");
const accountController = require("../src/controllers/accountController");

describe("hasUSDCTrustline", () => {
  const validPublicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns true when a USDC balance entry exists", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "100" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", balance: "5" },
      ],
    });

    await expect(stellarService.hasUSDCTrustline(validPublicKey)).resolves.toBe(true);
  });

  it("returns false when no USDC balance entry exists", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "100" }],
    });

    await expect(stellarService.hasUSDCTrustline(validPublicKey)).resolves.toBe(false);
  });

  it("controller responds with { hasTrustline: boolean }", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "100" }],
    });

    const req = { params: { publicKey: validPublicKey } };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await accountController.hasUSDCTrustline(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ hasTrustline: false });
    expect(next).not.toHaveBeenCalled();
  });
});

/**
 * __tests__/stellarService.assets.test.js
 * #1065 — stellarService.getAccountAssets mapping and validation.
 * Mocks the Horizon client at the SDK boundary (no network).
 */
"use strict";

const mockLoadAccount = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({ loadAccount: mockLoadAccount })),
  },
}));

const stellarService = require("../src/services/stellarService");

const KEY = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

describe("stellarService.getAccountAssets (#1065)", () => {
  beforeEach(() => {
    mockLoadAccount.mockReset();
  });

  it("returns only non-native trustlines with code, issuer, balance, limit", async () => {
    mockLoadAccount.mockResolvedValue({
      sequence: "1",
      subentry_count: 2,
      balances: [
        { asset_type: "native", balance: "99.5000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3GP3JCXACMUWUR5FQNB5KFK5DV3",
          balance: "12.5000000",
          limit: "1000.0000000",
        },
        {
          asset_type: "credit_alphanum12",
          asset_code: "LONGASSET",
          asset_issuer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
          balance: "0.0000000",
          limit: "922337203685.4775807",
        },
      ],
    });

    const assets = await stellarService.getAccountAssets(KEY);

    expect(mockLoadAccount).toHaveBeenCalledWith(KEY);
    expect(assets).toEqual([
      {
        assetCode: "USDC",
        assetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3GP3JCXACMUWUR5FQNB5KFK5DV3",
        balance: "12.5000000",
        limit: "1000.0000000",
      },
      {
        assetCode: "LONGASSET",
        assetIssuer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
        balance: "0.0000000",
        limit: "922337203685.4775807",
      },
    ]);
  });

  it("returns an empty array for an account holding only XLM", async () => {
    mockLoadAccount.mockResolvedValue({
      sequence: "1",
      subentry_count: 0,
      balances: [{ asset_type: "native", balance: "10.0000000" }],
    });

    await expect(stellarService.getAccountAssets(KEY)).resolves.toEqual([]);
  });

  it("rejects an invalid public key with status 400 before hitting Horizon", async () => {
    await expect(stellarService.getAccountAssets("not-a-key")).rejects.toMatchObject({
      status: 400,
    });
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });
});

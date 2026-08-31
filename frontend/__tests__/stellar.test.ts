import { Asset } from "@stellar/stellar-sdk";
import {
  TransactionCategory,
  horizonAssetToAsset,
  walletBalanceToAsset,
  InvalidAssetError,
  USDC,
} from "@/lib/stellar";

const VALID_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("Stellar helper", () => {
  it("categories", () => {
    expect(TransactionCategory.Payment).toBe("Payment");
    expect(TransactionCategory.Merge).toBe("Merge");
  });

  it.each([
    [0, "pending"],
    [1, "claimable"],
    [2, "claimed"],
    [3, "cancelled"],
  ])("maps %i to %s", (status, expected) => {
    expect(resolveEscrowStatus({ status })).toBe(expected);
  });
});

describe("horizonAssetToAsset (#715)", () => {
  it("returns native Asset instances for native records", () => {
    const asset = horizonAssetToAsset({ asset_type: "native" });
    expect(asset.isNative()).toBe(true);
    expect(asset.getCode()).toBe("XLM");
  });

  it("returns issued Asset instances for valid Horizon records", () => {
    const asset = horizonAssetToAsset({
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: VALID_ISSUER,
    });
    expect(asset.isNative()).toBe(false);
    expect(asset.getCode()).toBe("USDC");
    expect(asset.getIssuer()).toBe(VALID_ISSUER);
  });

  it("rejects issued assets missing code or issuer", () => {
    expect(() =>
      horizonAssetToAsset({ asset_type: "credit_alphanum4", asset_code: "USDC" })
    ).toThrow(InvalidAssetError);
    expect(() =>
      horizonAssetToAsset({ asset_type: "credit_alphanum4", asset_issuer: VALID_ISSUER })
    ).toThrow(InvalidAssetError);
  });

  it("rejects issued assets with malformed issuer addresses", () => {
    expect(() =>
      horizonAssetToAsset({
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "not-a-key",
      })
    ).toThrow(InvalidAssetError);
  });
});

describe("walletBalanceToAsset (#715)", () => {
  it("converts native wallet balances to Asset.native()", () => {
    const asset = walletBalanceToAsset({
      asset: "native",
      balance: "10.0000000",
      assetCode: "XLM",
    });
    expect(asset.isNative()).toBe(true);
  });

  it("converts issued wallet balances using CODE:ISSUER identifiers", () => {
    const asset = walletBalanceToAsset({
      asset: `USDC:${VALID_ISSUER}`,
      balance: "5.0000000",
      assetCode: "USDC",
    });
    expect(asset.equals(USDC)).toBe(true);
  });

  it("rejects malformed issued wallet balance identifiers", () => {
    expect(() =>
      walletBalanceToAsset({
        asset: "USDC-only",
        balance: "1.0000000",
        assetCode: "USDC",
      })
    ).toThrow(InvalidAssetError);
  });
});

describe("trade asset SDK compatibility (#715)", () => {
  it("exposes isNative and path helpers on converted assets", () => {
    const native = walletBalanceToAsset({
      asset: "native",
      balance: "0",
      assetCode: "XLM",
    });
    const issued = horizonAssetToAsset({
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: VALID_ISSUER,
    });

    expect(typeof native.isNative).toBe("function");
    expect(typeof issued.isNative).toBe("function");
    expect(issued.equals(Asset.fromOperation(issued.toXDRObject()))).toBe(true);
  });
});

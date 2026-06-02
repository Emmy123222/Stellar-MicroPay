/**
 * Issue #198 — SSR guard tests for lib/wallet.ts.
 *
 * Freighter calls access `window.freighter`; during Next.js SSR `window` is
 * undefined and any unguarded call throws a ReferenceError. These tests verify
 * that isFreighterInstalled, hasSiteAccess, and signTransactionWithWallet
 * return safe defaults instead of throwing when `window` is undefined.
 *
 * @jest-environment node
 */

import { jest, describe, test, expect } from "@jest/globals";

// Mock @stellar/freighter-api so no real browser extension is needed.
jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  isAllowed: jest.fn(),
  getAddress: jest.fn(),
  signTransaction: jest.fn(),
  requestAccess: jest.fn(),
}));

// Mock lib/stellar to avoid network calls.
jest.mock("@/lib/stellar", () => ({
  getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
  TransactionCategory: {},
}));

// In the `node` jest environment `window` is already undefined — these tests
// directly exercise the SSR branches of each guarded function.

describe("wallet.ts — SSR guards (issue #198)", () => {
  test("isFreighterInstalled returns false when window is undefined", async () => {
    const { isFreighterInstalled } = await import("@/lib/wallet");
    expect(typeof window).toBe("undefined");
    const result = await isFreighterInstalled();
    expect(result).toBe(false);
  });

  test("hasSiteAccess returns false when window is undefined", async () => {
    const { hasSiteAccess } = await import("@/lib/wallet");
    const result = await hasSiteAccess();
    expect(result).toBe(false);
  });

  test("signTransactionWithWallet returns error when window is undefined", async () => {
    const { signTransactionWithWallet } = await import("@/lib/wallet");
    const result = await signTransactionWithWallet("fake-xdr");
    expect(result.signedXDR).toBeNull();
    expect(result.error).toMatch(/server-side rendering/i);
  });
});

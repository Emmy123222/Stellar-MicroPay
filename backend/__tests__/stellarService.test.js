/**
 * __tests__/stellarService.test.js
 * Unit tests for Stellar service with mocked Horizon SDK.
 */

"use strict";

const mockLoadAccount = jest.fn();
const mockPaymentsCall = jest.fn();
const mockPaymentsCursor = jest.fn();
const mockPaymentsOrder = jest.fn();
const mockPaymentsLimit = jest.fn();
const mockPaymentsForAccount = jest.fn();
const mockPayments = jest.fn();

jest.mock("@stellar/stellar-sdk", () => {
  mockPaymentsCursor.mockImplementation(() => ({ call: mockPaymentsCall }));
  mockPaymentsOrder.mockImplementation(() => ({ cursor: mockPaymentsCursor, call: mockPaymentsCall }));
  mockPaymentsLimit.mockImplementation(() => ({ order: mockPaymentsOrder }));
  mockPaymentsForAccount.mockImplementation(() => ({ limit: mockPaymentsLimit }));
  mockPayments.mockImplementation(() => ({ forAccount: mockPaymentsForAccount }));

  return {
    Horizon: {
      Server: jest.fn(() => ({
        loadAccount: mockLoadAccount,
        payments: mockPayments,
      })),
    },
  };
});

const stellarService = require("../src/services/stellarService");

describe("stellarService", () => {
  const validPublicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  beforeEach(() => {
    jest.clearAllMocks();
    mockPaymentsCursor.mockImplementation(() => ({ call: mockPaymentsCall }));
    mockPaymentsOrder.mockImplementation(() => ({ cursor: mockPaymentsCursor, call: mockPaymentsCall }));
    mockPaymentsLimit.mockImplementation(() => ({ order: mockPaymentsOrder }));
    mockPaymentsForAccount.mockImplementation(() => ({ limit: mockPaymentsLimit }));
    mockPayments.mockImplementation(() => ({ forAccount: mockPaymentsForAccount }));
  });

  describe("validatePublicKey", () => {
    it("accepts a valid Stellar public key", () => {
      expect(() => stellarService.validatePublicKey(validPublicKey)).not.toThrow();
    });

    it("throws on an empty public key", () => {
      expect(() => stellarService.validatePublicKey("")).toThrow(
        "Invalid Stellar public key format"
      );
    });

    it("throws on an invalid prefix", () => {
      const invalidPrefix = `S${validPublicKey.slice(1)}`;
      expect(() => stellarService.validatePublicKey(invalidPrefix)).toThrow(
        "Invalid Stellar public key format"
      );
    });
  });

  describe("getXLMBalance", () => {
    it("returns native XLM balance for a valid account", async () => {
      mockLoadAccount.mockResolvedValue({
        sequence: "12345",
        subentry_count: 2,
        balances: [
          { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "10.50" },
          { asset_type: "native", balance: "42.1234567" },
        ],
      });

      const balance = await stellarService.getXLMBalance(validPublicKey);

      expect(balance).toBe("42.1234567");
      expect(mockLoadAccount).toHaveBeenCalledWith(validPublicKey);
    });

    it("returns 0 when account has no native balance entry", async () => {
      mockLoadAccount.mockResolvedValue({
        sequence: "12345",
        subentry_count: 2,
        balances: [{ asset_type: "credit_alphanum4", asset_code: "USDC", balance: "10.50" }],
      });

      const balance = await stellarService.getXLMBalance(validPublicKey);

      expect(balance).toBe("0");
    });

    it("throws a friendly 404 error for unfunded accounts", async () => {
      mockLoadAccount.mockRejectedValue({ response: { status: 404 } });

      await expect(stellarService.getXLMBalance(validPublicKey)).rejects.toMatchObject({
        status: 404,
      });
      await expect(stellarService.getXLMBalance(validPublicKey)).rejects.toThrow(
        "Account not found. It may not be funded yet. Use Friendbot on testnet."
      );
    });
  });

  describe("getPayments", () => {
    it("returns correctly shaped payment objects and filters non-payment ops", async () => {
      const textMemoTransaction = jest.fn().mockResolvedValue({ memo_type: "text", memo: "hello" });
      const noMemoTransaction = jest.fn().mockResolvedValue({ memo_type: "none" });

      mockPaymentsCall.mockResolvedValue({
        records: [
          {
            id: "op-1",
            type: "payment",
            amount: "5.0000000",
            asset_type: "native",
            from: validPublicKey,
            to: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBC",
            created_at: "2026-03-27T10:00:00Z",
            transaction_hash: "txhash1",
            paging_token: "pt1",
            transaction: textMemoTransaction,
          },
          {
            id: "op-2",
            type: "create_account",
            amount: "1.0000000",
            asset_type: "native",
            from: validPublicKey,
            to: validPublicKey,
            created_at: "2026-03-27T10:01:00Z",
            transaction_hash: "txhash2",
            paging_token: "pt2",
            transaction: noMemoTransaction,
          },
          {
            id: "op-3",
            type: "payment",
            amount: "2.5000000",
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            from: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
            to: validPublicKey,
            created_at: "2026-03-27T10:02:00Z",
            transaction_hash: "txhash3",
            paging_token: "pt3",
            transaction: noMemoTransaction,
          },
        ],
      });

      const result = await stellarService.getPayments(validPublicKey, { limit: 10 });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "op-1",
        type: "sent",
        amount: "5.0000000",
        asset: "XLM",
        from: validPublicKey,
        to: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBC",
        memo: "hello",
        createdAt: "2026-03-27T10:00:00Z",
        transactionHash: "txhash1",
        pagingToken: "pt1",
      });
      expect(result[1]).toEqual({
        id: "op-3",
        type: "received",
        amount: "2.5000000",
        asset: "USDC",
        from: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        to: validPublicKey,
        memo: undefined,
        createdAt: "2026-03-27T10:02:00Z",
        transactionHash: "txhash3",
        pagingToken: "pt3",
      });
      expect(mockPaymentsForAccount).toHaveBeenCalledWith(validPublicKey);
      expect(mockPaymentsLimit).toHaveBeenCalledWith(10);
      expect(mockPaymentsOrder).toHaveBeenCalledWith("desc");
    });

    it("uses cursor when provided", async () => {
      mockPaymentsCall.mockResolvedValue({ records: [] });

      await stellarService.getPayments(validPublicKey, { limit: 5, cursor: "12345" });

      expect(mockPaymentsCursor).toHaveBeenCalledWith("12345");
    });

    it("throws on invalid public key before any Horizon call", async () => {
      await expect(stellarService.getPayments("invalid-key")).rejects.toThrow(
        "Invalid Stellar public key format"
      );
      expect(mockPayments).not.toHaveBeenCalled();
    });
  });
});

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

  describe("getAccountStreaks", () => {
    afterEach(() => {
      stellarService.clearStreaksCache();
    });

    it("handles 0-day streak scenario", async () => {
      mockPaymentsCall.mockResolvedValue({ records: [] });
      const result = await stellarService.getAccountStreaks(validPublicKey);
      expect(result).toEqual({ currentStreak: 0, longestStreak: 0, lastTransactionDate: null });
    });

    it("handles 1-day streak scenario", async () => {
      const today = new Date().toISOString().split("T")[0];
      mockPaymentsCall.mockResolvedValue({
        records: [
          { type: "payment", created_at: `${today}T10:00:00Z` }
        ]
      });
      const result = await stellarService.getAccountStreaks(validPublicKey);
      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(1);
    });

    it("handles 7-day streak scenario", async () => {
      const records = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        records.push({ type: "payment", created_at: d.toISOString() });
      }
      mockPaymentsCall.mockResolvedValue({ records });
      const result = await stellarService.getAccountStreaks(validPublicKey);
      expect(result.currentStreak).toBe(7);
      expect(result.longestStreak).toBe(7);
    });

    it("handles 30-day streak scenario", async () => {
      const records = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        records.push({ type: "payment", created_at: d.toISOString() });
      }
      mockPaymentsCall.mockResolvedValue({ records });
      const result = await stellarService.getAccountStreaks(validPublicKey);
      expect(result.currentStreak).toBe(30);
      expect(result.longestStreak).toBe(30);
    });
    
    it("handles broken streak", async () => {
      const today = new Date();
      const d1 = new Date(today);
      d1.setDate(d1.getDate() - 1); // yesterday
      const d2 = new Date(today);
      d2.setDate(d2.getDate() - 2);
      const d4 = new Date(today);
      d4.setDate(d4.getDate() - 4);
      const d5 = new Date(today);
      d5.setDate(d5.getDate() - 5);
      const d6 = new Date(today);
      d6.setDate(d6.getDate() - 6);
      
      mockPaymentsCall.mockResolvedValue({
        records: [
          { type: "payment", created_at: d1.toISOString() }, // active streak = 2
          { type: "payment", created_at: d2.toISOString() },
          { type: "payment", created_at: d4.toISOString() }, // older 3-day streak
          { type: "payment", created_at: d5.toISOString() },
          { type: "payment", created_at: d6.toISOString() }, 
        ]
      });
      const result = await stellarService.getAccountStreaks(validPublicKey);
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(3);
    });
  });

  describe("getMemoHistory", () => {
    it("returns the 10 most recent distinct MEMO_TEXT memos from a fixture of 20 payments", async () => {
      const records = [
        // 1. Text memo: "Memo 1 (newest)"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 1 (newest)" }) },
        // 2. Hash memo (should be ignored)
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "hash", memo: "0x1234567890abcdef" }) },
        // 3. Text memo: "Memo 2"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 2" }) },
        // 4. No memo (should be ignored)
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "none" }) },
        // 5. Text memo duplicate: "Memo 1 (newest)" (should be ignored)
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 1 (newest)" }) },
        // 6. ID memo (should be ignored)
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "id", memo: "123456" }) },
        // 7. Text memo: "Memo 3"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 3" }) },
        // 8. Text memo: "Memo 4"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 4" }) },
        // 9. Text memo: "Memo 5"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 5" }) },
        // 10. Return memo (should be ignored)
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "return", memo: "0xabcdef" }) },
        // 11. Text memo: "Memo 6"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 6" }) },
        // 12. Text memo: "Memo 7"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 7" }) },
        // 13. Text memo duplicate: "Memo 2" (should be ignored)
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 2" }) },
        // 14. Text memo: "Memo 8"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 8" }) },
        // 15. Text memo: "Memo 9"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 9" }) },
        // 16. Text memo: "Memo 10"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 10" }) },
        // 17. Text memo: "Memo 11" (11th distinct memo - capped by limit 10)
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 11" }) },
        // 18. Text memo: "Memo 12"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 12" }) },
        // 19. Text memo: "Memo 13"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 13" }) },
        // 20. Text memo: "Memo 14"
        { type: "payment", transaction: jest.fn().mockResolvedValue({ memo_type: "text", memo: "Memo 14" }) },
      ];

      mockPaymentsCall.mockResolvedValue({ records });

      const result = await stellarService.getMemoHistory(validPublicKey);

      expect(result).toHaveLength(10);
      expect(result).toEqual([
        "Memo 1 (newest)",
        "Memo 2",
        "Memo 3",
        "Memo 4",
        "Memo 5",
        "Memo 6",
        "Memo 7",
        "Memo 8",
        "Memo 9",
        "Memo 10",
      ]);
    });

    it("returns empty array when account has no payments or text memos", async () => {
      mockPaymentsCall.mockResolvedValue({ records: [] });
      const result = await stellarService.getMemoHistory(validPublicKey);
      expect(result).toEqual([]);
    });

    it("throws error on invalid public key", async () => {
      await expect(stellarService.getMemoHistory("invalid-key")).rejects.toThrow(
        "Invalid Stellar public key format"
      );
    });
  });
});


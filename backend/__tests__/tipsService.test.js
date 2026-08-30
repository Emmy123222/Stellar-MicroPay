/**
 * __tests__/tipsService.test.js
 * Unit tests for tipsService (issue #531).
 *
 * Tests aggregation logic (totals, per-recipient stats) isolated from controller layer.
 */

"use strict";

const tipsService = require("../src/services/tipsService");

const KEY_A = "G" + "A".repeat(55); // 56 chars
const KEY_B = "G" + "B".repeat(55); // 56 chars
const KEY_C = "G" + "C".repeat(55); // 56 chars
const KEY_D = "G" + "D".repeat(55); // 56 chars
const KEY_E = "G" + "E".repeat(55); // 56 chars

describe("tipsService", () => {
  beforeEach(() => {
    // Clear in-memory storage before each test
    tipsService.tipsByCreator?.clear?.();
    // Reset tip ID counter
    tipsService.tipIdCounter = 1;
  });

  describe("recordTip", () => {
    it("records a tip successfully", () => {
      const tip = tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.5",
        asset: "XLM",
        memo: "Great work!",
        txHash: "abc123",
      });

      expect(tip).toHaveProperty("id");
      expect(tip.senderPublicKey).toBe(KEY_A);
      expect(tip.creatorPublicKey).toBe(KEY_B);
      expect(tip.amount).toBe("10.5");
      expect(tip.asset).toBe("XLM");
      expect(tip.memo).toBe("Great work!");
      expect(tip.txHash).toBe("abc123");
      expect(tip).toHaveProperty("timestamp");
    });

    it("throws error when missing required fields", () => {
      expect(() =>
        tipsService.recordTip({
          creatorPublicKey: KEY_B,
          amount: "10.5",
        })
      ).toThrow("senderPublicKey, creatorPublicKey, and amount are required");
    });

    it("defaults asset to XLM when not provided", () => {
      const tip = tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "5.0",
      });

      expect(tip.asset).toBe("XLM");
    });
  });

  describe("getTipsReceived", () => {
    beforeEach(() => {
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: KEY_C,
        creatorPublicKey: KEY_B,
        amount: "5.0",
        asset: "USDC",
      });
    });

    it("returns tips for a creator", () => {
      const result = tipsService.getTipsReceived(KEY_B);

      expect(result.tips).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("returns empty array for creator with no tips", () => {
      const result = tipsService.getTipsReceived(KEY_A);

      expect(result.tips).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("supports pagination with limit and offset", () => {
      const result = tipsService.getTipsReceived(KEY_B, { limit: 1, offset: 0 });

      expect(result.tips).toHaveLength(1);
      expect(result.total).toBe(2);
    });

    it("throws error when creatorPublicKey is missing", () => {
      expect(() => tipsService.getTipsReceived()).toThrow("creatorPublicKey is required");
    });
  });

  describe("getTipsStats", () => {
    beforeEach(() => {
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: KEY_C,
        creatorPublicKey: KEY_B,
        amount: "5.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: KEY_D,
        creatorPublicKey: KEY_B,
        amount: "15.0",
        asset: "USDC",
      });
    });

    it("calculates total tips correctly", () => {
      const stats = tipsService.getTipsStats(KEY_B);

      expect(stats.totalTips).toBe(3);
    });

    it("sums total tip amount correctly across records", () => {
      const stats = tipsService.getTipsStats(KEY_B);

      expect(stats.totalByAsset.XLM.amount).toBe("15");
      expect(stats.totalByAsset.XLM.count).toBe(2);
      expect(stats.totalByAsset.USDC.amount).toBe("15");
      expect(stats.totalByAsset.USDC.count).toBe(1);
    });

    it("calculates average tip correctly", () => {
      const stats = tipsService.getTipsStats(KEY_B);

      expect(stats.averageTip).toBe("10");
    });

    it("identifies largest and smallest tips", () => {
      const stats = tipsService.getTipsStats(KEY_B);

      expect(stats.largestTip).toBe("15");
      expect(stats.smallestTip).toBe("5");
    });

    it("returns zero stats for creator with no tips", () => {
      const stats = tipsService.getTipsStats(KEY_A);

      expect(stats.totalTips).toBe(0);
      expect(stats.averageTip).toBe(null);
    });

    it("throws error when creatorPublicKey is missing", () => {
      expect(() => tipsService.getTipsStats()).toThrow("creatorPublicKey is required");
    });

    it("provides per-asset averages", () => {
      const stats = tipsService.getTipsStats(KEY_B);
      // XLM: 10 + 5 = 15, count 2 → average 7.5
      expect(stats.totalByAsset.XLM.average).toBe("7.5");
      // USDC: 15, count 1 → average 15
      expect(stats.totalByAsset.USDC.average).toBe("15");
    });

    it("handles fractional stroop boundaries without rounding errors", () => {
      tipsService.tipsByCreator.clear();
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "0.0000001", asset: "XLM" });
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "0.0000002", asset: "XLM" });

      const stats = tipsService.getTipsStats(KEY_B);
      expect(stats.totalByAsset.XLM.amount).toBe("0.0000003");
      expect(stats.totalByAsset.XLM.count).toBe(2);
      // average: 0.00000015 stroops — 3 is not divisible by 2 in integer math, truncates
      expect(stats.totalByAsset.XLM.average).toBe("0.0000001");
    });

    it("handles large totals without floating-point loss", () => {
      tipsService.tipsByCreator.clear();
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "999999999.9999999", asset: "XLM" });
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "0.0000001", asset: "XLM" });

      const stats = tipsService.getTipsStats(KEY_B);
      expect(stats.totalByAsset.XLM.amount).toBe("1000000000");
    });
  });

  describe("getTipsSent", () => {
    beforeEach(() => {
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_C,
        amount: "5.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: KEY_D,
        creatorPublicKey: KEY_B,
        amount: "15.0",
        asset: "XLM",
      });
    });

    it("returns tips sent by a specific sender", () => {
      const result = tipsService.getTipsSent(KEY_A);

      expect(result.tips).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("returns empty array for sender with no tips sent", () => {
      const result = tipsService.getTipsSent(KEY_B);

      expect(result.tips).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("throws error when senderPublicKey is missing", () => {
      expect(() => tipsService.getTipsSent()).toThrow("senderPublicKey is required");
    });
  });

  describe("getTopTippers", () => {
    beforeEach(() => {
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "5.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: KEY_C,
        creatorPublicKey: KEY_B,
        amount: "15.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: KEY_D,
        creatorPublicKey: KEY_B,
        amount: "2.5",
        asset: "XLM",
      });
    });

    it("returns top tippers sorted by total amount", () => {
      const result = tipsService.getTopTippers(KEY_B, 3);

      expect(result).toHaveLength(3);
      expect(parseFloat(result[0].totalAmount)).toBe(15);
      expect(parseFloat(result[1].totalAmount)).toBe(15);
      expect(parseFloat(result[2].totalAmount)).toBe(2.5);
    });

    it("respects limit parameter", () => {
      const result = tipsService.getTopTippers(KEY_B, 2);

      expect(result).toHaveLength(2);
    });

    it("returns empty array for creator with no tips", () => {
      const result = tipsService.getTopTippers(KEY_E);

      expect(result).toHaveLength(0);
    });

    it("throws error when creatorPublicKey is missing", () => {
      expect(() => tipsService.getTopTippers()).toThrow("creatorPublicKey is required");
    });
  });

  describe("validateTipInput", () => {
    it("validates correct input", () => {
      const data = {
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).not.toThrow();
    });

    it("throws error for missing senderPublicKey", () => {
      const data = {
        creatorPublicKey: KEY_B,
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("senderPublicKey is required");
    });

    it("throws error for invalid senderPublicKey format", () => {
      const data = {
        senderPublicKey: "invalid_key",
        creatorPublicKey: KEY_B,
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("Invalid sender public key format");
    });

    it("throws error for missing creatorPublicKey", () => {
      const data = {
        senderPublicKey: KEY_A,
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("creatorPublicKey is required");
    });

    it("throws error for invalid creatorPublicKey format", () => {
      const data = {
        senderPublicKey: KEY_A,
        creatorPublicKey: "invalid_key",
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("Invalid creator public key format");
    });

    it("throws error for missing amount", () => {
      const data = {
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("amount is required");
    });

    it("throws error for non-numeric amount", () => {
      const data = {
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "not_a_number",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("amount must be a positive number");
    });

    it("throws error for zero or negative amount", () => {
      const data = {
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("amount must be a positive number");
    });
  });
});

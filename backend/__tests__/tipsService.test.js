/**
 * __tests__/tipsService.test.js
 * Unit tests for tipsService (issue #531).
 *
 * Tests aggregation logic (totals, per-recipient stats) isolated from controller layer.
 */

"use strict";

const tipsService = require("../src/services/tipsService");

describe("tipsService", () => {
  beforeEach(() => {
    // Clear in-memory storage before each test
    tipsService._clearForTesting();
  });

  describe("recordTip", () => {
    it("records a tip successfully", () => {
      const tip = tipsService.recordTip({
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "10.5",
        asset: "XLM",
        memo: "Great work!",
        txHash: "abc123",
      });

      expect(tip).toHaveProperty("id");
      expect(tip.senderPublicKey).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
      expect(tip.creatorPublicKey).toBe("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
      expect(tip.amount).toBe("10.5");
      expect(tip.asset).toBe("XLM");
      expect(tip.memo).toBe("Great work!");
      expect(tip.txHash).toBe("abc123");
      expect(tip).toHaveProperty("timestamp");
    });

    it("throws error when required fields are missing", () => {
      expect(() => {
        tipsService.recordTip({
          senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          // missing creatorPublicKey and amount
        });
      }).toThrow("senderPublicKey, creatorPublicKey, and amount are required");
    });

    it("defaults asset to XLM when not provided", () => {
      const tip = tipsService.recordTip({
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "5.0",
      });

      expect(tip.asset).toBe("XLM");
    });
  });

  describe("getTipsReceived", () => {
    beforeEach(() => {
      // Setup test data
      tipsService.recordTip({
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "10.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "5.0",
        asset: "USDC",
      });
    });

    it("returns tips for a creator", () => {
      const result = tipsService.getTipsReceived("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

      expect(result.tips).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("returns empty array for creator with no tips", () => {
      const result = tipsService.getTipsReceived("GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD");

      expect(result.tips).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("supports pagination with limit and offset", () => {
      const result = tipsService.getTipsReceived(
        "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        { limit: 1, offset: 0 }
      );

      expect(result.tips).toHaveLength(1);
      expect(result.limit).toBe(1);
      expect(result.offset).toBe(0);
    });

    it("throws error when creatorPublicKey is missing", () => {
      expect(() => tipsService.getTipsReceived()).toThrow("creatorPublicKey is required");
    });
  });

  describe("getTipsStats", () => {
    beforeEach(() => {
      // Setup test data
      tipsService.recordTip({
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "10.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "5.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "15.0",
        asset: "USDC",
      });
    });

    it("calculates total tips correctly", () => {
      const stats = tipsService.getTipsStats("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

      expect(stats.totalTips).toBe(3);
    });

    it("sums total tip amount correctly across records", () => {
      const stats = tipsService.getTipsStats("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

      // XLM: 10.0 + 5.0 = 15.0
      expect(stats.totalByAsset.XLM.amount).toBe("15");
      expect(stats.totalByAsset.XLM.count).toBe(2);

      // USDC: 15.0
      expect(stats.totalByAsset.USDC.amount).toBe("15");
      expect(stats.totalByAsset.USDC.count).toBe(1);
    });

    it("calculates average tip correctly", () => {
      const stats = tipsService.getTipsStats("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

      // Average: (10 + 5 + 15) / 3 = 10
      expect(stats.averageTip).toBe("10");
    });

    it("identifies largest and smallest tips", () => {
      const stats = tipsService.getTipsStats("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

      expect(stats.largestTip).toBe("15");
      expect(stats.smallestTip).toBe("5");
    });

    it("returns well-formed empty result for zero-tips case", () => {
      const stats = tipsService.getTipsStats("GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD");

      expect(stats.totalTips).toBe(0);
      expect(stats.totalByAsset).toEqual({});
      expect(stats.averageTip).toBeNull();
      expect(stats.largestTip).toBeNull();
      expect(stats.smallestTip).toBeNull();
      // Should not throw an error
      expect(stats).toBeDefined();
    });

    it("throws error when creatorPublicKey is missing", () => {
      expect(() => tipsService.getTipsStats()).toThrow("creatorPublicKey is required");
    });
  });

  describe("getTipsSent", () => {
    beforeEach(() => {
      // Setup test data - same sender sending to different creators
      tipsService.recordTip({
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "10.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        amount: "5.0",
        asset: "USDC",
      });
      tipsService.recordTip({
        senderPublicKey: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "15.0",
        asset: "XLM",
      });
    });

    it("returns tips sent by a user", () => {
      const result = tipsService.getTipsSent("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

      expect(result.tips).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("returns empty array for user with no sent tips", () => {
      const result = tipsService.getTipsSent("GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");

      expect(result.tips).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("throws error when senderPublicKey is missing", () => {
      expect(() => tipsService.getTipsSent()).toThrow("senderPublicKey is required");
    });
  });

  describe("getTopTippers", () => {
    beforeEach(() => {
      // Setup test data
      tipsService.recordTip({
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "10.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "5.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "15.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "2.5",
        asset: "XLM",
      });
    });

    it("returns top tippers sorted by total amount", () => {
      const result = tipsService.getTopTippers("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", 3);

      expect(result).toHaveLength(3);
      // First two tippers both sent 15 total (tie — order is non-deterministic)
      expect(parseFloat(result[0].totalAmount)).toBe(15);
      expect(parseFloat(result[1].totalAmount)).toBe(15);
      const topTwoKeys = [result[0].senderPublicKey, result[1].senderPublicKey].sort();
      expect(topTwoKeys).toEqual([
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      ]);
      // GDDDDDDDD... sent 2.5
      expect(result[2].senderPublicKey).toBe("GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD");
      expect(parseFloat(result[2].totalAmount)).toBe(2.5);
    });

    it("respects limit parameter", () => {
      const result = tipsService.getTopTippers("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", 2);

      expect(result).toHaveLength(2);
    });

    it("returns empty array for creator with no tips", () => {
      const result = tipsService.getTopTippers("GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");

      expect(result).toHaveLength(0);
    });

    it("throws error when creatorPublicKey is missing", () => {
      expect(() => tipsService.getTopTippers()).toThrow("creatorPublicKey is required");
    });
  });

  describe("validateTipInput", () => {
    it("validates correct input", () => {
      const data = {
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).not.toThrow();
    });

    it("throws error for missing senderPublicKey", () => {
      const data = {
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("senderPublicKey is required");
    });

    it("throws error for invalid senderPublicKey format", () => {
      const data = {
        senderPublicKey: "invalid_key",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("Invalid sender public key format");
    });

    it("throws error for missing creatorPublicKey", () => {
      const data = {
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("creatorPublicKey is required");
    });

    it("throws error for invalid creatorPublicKey format", () => {
      const data = {
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "invalid_key",
        amount: "10.0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("Invalid creator public key format");
    });

    it("throws error for missing amount", () => {
      const data = {
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("amount is required");
    });

    it("throws error for non-numeric amount", () => {
      const data = {
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "not_a_number",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("amount must be a positive number");
    });

    it("throws error for zero or negative amount", () => {
      const data = {
        senderPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "0",
      };

      expect(() => tipsService.validateTipInput(data)).toThrow("amount must be a positive number");
    });
  });
});

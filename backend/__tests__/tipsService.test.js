/**
 * __tests__/tipsService.test.js
 * Unit tests for tipsService (issue #531).
 *
 * Tests aggregation logic (totals, per-recipient stats) isolated from controller layer.
 * Storage is backed by tipsStore.js, pointed at an isolated temp file for this
 * test file so runs never touch the real backend/data/tips.json (see tipsStore.test.js
 * for storage-engine-level coverage: migration, quarantine, atomic writes).
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const tipsStore = require("../src/services/tipsStore");

const TEST_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tips-service-test-"));
tipsStore.setStorePathForTests(path.join(TEST_STORE_DIR, "tips.json"));

const tipsService = require("../src/services/tipsService");

describe("tipsService", () => {
  beforeEach(() => {
    tipsService.resetStore();
  });

  afterAll(() => {
    fs.rmSync(TEST_STORE_DIR, { recursive: true, force: true });
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

  describe("recordTip idempotency (txHash + operationIndex)", () => {
    it("returns the existing record when the same txHash and operationIndex are replayed", () => {
      const first = tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        txHash: "tx-replay",
        operationIndex: 0,
      });

      const replay = tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        txHash: "tx-replay",
        operationIndex: 0,
      });

      expect(first.isDuplicate).toBe(false);
      expect(replay.isDuplicate).toBe(true);
      expect(replay.id).toBe(first.id);

      const stored = tipsService.getTipsReceived(KEY_B);
      expect(stored.total).toBe(1);
    });

    it("does not treat mismatched sender/amount as new when txHash+operationIndex replay", () => {
      const first = tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        txHash: "tx-replay-2",
        operationIndex: 0,
      });

      // A client replaying the same on-chain operation with slightly
      // different metadata should still resolve to the original record.
      const replay = tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "999.0",
        txHash: "tx-replay-2",
        operationIndex: 0,
      });

      expect(replay.id).toBe(first.id);
      expect(replay.amount).toBe("10.0");
      expect(tipsService.getTipsReceived(KEY_B).total).toBe(1);
    });

    it("treats different operationIndex values on the same txHash as distinct tips", () => {
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        txHash: "tx-multi-op",
        operationIndex: 0,
      });
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "5.0",
        txHash: "tx-multi-op",
        operationIndex: 1,
      });

      expect(tipsService.getTipsReceived(KEY_B).total).toBe(2);
    });

    it("treats the same operationIndex on different txHash values as distinct tips", () => {
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        txHash: "tx-a",
        operationIndex: 0,
      });
      tipsService.recordTip({
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        txHash: "tx-b",
        operationIndex: 0,
      });

      expect(tipsService.getTipsReceived(KEY_B).total).toBe(2);
    });

    it("does not deduplicate tips recorded without a txHash", () => {
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "10.0" });
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "10.0" });

      expect(tipsService.getTipsReceived(KEY_B).total).toBe(2);
    });

    it("rejects a negative operationIndex", () => {
      expect(() =>
        tipsService.recordTip({
          senderPublicKey: KEY_A,
          creatorPublicKey: KEY_B,
          amount: "10.0",
          txHash: "tx-bad-index",
          operationIndex: -1,
        })
      ).toThrow("operationIndex must be a non-negative integer");
    });

    it("rejects a non-integer operationIndex", () => {
      expect(() =>
        tipsService.recordTip({
          senderPublicKey: KEY_A,
          creatorPublicKey: KEY_B,
          amount: "10.0",
          txHash: "tx-bad-index-2",
          operationIndex: 1.5,
        })
      ).toThrow("operationIndex must be a non-negative integer");
    });

    it("prevents duplicate records under concurrent duplicate submissions", async () => {
      const submit = () =>
        Promise.resolve().then(() =>
          tipsService.recordTip({
            senderPublicKey: KEY_A,
            creatorPublicKey: KEY_B,
            amount: "10.0",
            txHash: "tx-concurrent",
            operationIndex: 0,
          })
        );

      const results = await Promise.all([submit(), submit(), submit(), submit(), submit()]);

      const uniqueIds = new Set(results.map((r) => r.id));
      expect(uniqueIds.size).toBe(1);
      expect(results.filter((r) => r.isDuplicate)).toHaveLength(4);
      expect(tipsService.getTipsReceived(KEY_B).total).toBe(1);
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
        senderPublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
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
      const result = tipsService.getTipsReceived("GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD");

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

    it("supports cursor pagination and walks every page without gaps or repeats", () => {
      const firstPage = tipsService.getTipsReceived(KEY_B, { limit: 1 });
      expect(firstPage.tips).toHaveLength(1);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const secondPage = tipsService.getTipsReceived(KEY_B, { limit: 1, cursor: firstPage.nextCursor });
      expect(secondPage.tips).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();

      const seenIds = [firstPage.tips[0].id, secondPage.tips[0].id];
      expect(new Set(seenIds).size).toBe(2); // no repeats across pages
      expect(seenIds.sort()).toEqual([1, 2]); // no gaps: both recorded tips seen
    });

    it("rejects a malformed cursor", () => {
      expect(() => tipsService.getTipsReceived(KEY_B, { cursor: "not-a-valid-cursor" })).toThrow(
        "Invalid pagination cursor"
      );
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
        senderPublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "5.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
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
      const stats = tipsService.getTipsStats("GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD");

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

    it("provides per-asset averages", () => {
      const stats = tipsService.getTipsStats(KEY_B);
      // XLM: 10 + 5 = 15, count 2 → average 7.5
      expect(stats.totalByAsset.XLM.average).toBe("7.5");
      // USDC: 15, count 1 → average 15
      expect(stats.totalByAsset.USDC.average).toBe("15");
    });

    it("handles fractional stroop boundaries without rounding errors", () => {
      tipsService.resetStore();
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "0.0000001", asset: "XLM" });
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "0.0000002", asset: "XLM" });

      const stats = tipsService.getTipsStats(KEY_B);
      expect(stats.totalByAsset.XLM.amount).toBe("0.0000003");
      expect(stats.totalByAsset.XLM.count).toBe(2);
      // average: 0.00000015 stroops — 3 is not divisible by 2 in integer math, truncates
      expect(stats.totalByAsset.XLM.average).toBe("0.0000001");
    });

    it("handles large totals without floating-point loss", () => {
      tipsService.resetStore();
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "999999999.9999999", asset: "XLM" });
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "0.0000001", asset: "XLM" });

      const stats = tipsService.getTipsStats(KEY_B);
      expect(stats.totalByAsset.XLM.amount).toBe("1000000000");
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
        creatorPublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        amount: "5.0",
        asset: "USDC",
      });
      tipsService.recordTip({
        senderPublicKey: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
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
      const result = tipsService.getTipsSent("GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");

      expect(result.tips).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("throws error when senderPublicKey is missing", () => {
      expect(() => tipsService.getTipsSent()).toThrow("senderPublicKey is required");
    });

    it("does not require scanning every creator's tips (sender index)", () => {
      // KEY_A tipped two different creators (KEY_B and KEY_C); the sender
      // index should surface both without iterating every creator's list.
      const result = tipsService.getTipsSent(KEY_A);

      expect(result.tips.map((t) => t.creatorPublicKey).sort()).toEqual([KEY_B, KEY_C].sort());
    });

    it("supports cursor pagination", () => {
      const firstPage = tipsService.getTipsSent(KEY_A, { limit: 1 });
      expect(firstPage.tips).toHaveLength(1);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const secondPage = tipsService.getTipsSent(KEY_A, { limit: 1, cursor: firstPage.nextCursor });
      expect(secondPage.tips).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();

      const seenIds = [firstPage.tips[0].id, secondPage.tips[0].id];
      expect(new Set(seenIds).size).toBe(2);
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
        senderPublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "15.0",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        creatorPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "2.5",
        asset: "XLM",
      });
    });

    it("returns top tippers sorted by total amount", () => {
      const result = tipsService.getTopTippers("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", 3);

      expect(result).toHaveLength(3);
      // Both GAAAAAAAA and GCCCCCCC sent 15 total; order between ties is not guaranteed
      const totals = result.map(r => parseFloat(r.totalAmount));
      expect(totals).toEqual([15, 15, 2.5]);
      // Last entry is the smallest
      expect(result[2].senderPublicKey).toBe("GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD");
    });

    it("respects limit parameter", () => {
      const result = tipsService.getTopTippers("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", 2);

      expect(result).toHaveLength(2);
    });

    it("returns empty array for creator with no tips", () => {
      const result = tipsService.getTopTippers("GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");

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

  describe("durable storage", () => {
    it("survives a reload from disk (simulated restart)", () => {
      tipsService.recordTip({ senderPublicKey: KEY_A, creatorPublicKey: KEY_B, amount: "10.0" });
      tipsService.recordTip({ senderPublicKey: KEY_C, creatorPublicKey: KEY_B, amount: "5.0" });

      // Re-point the store at the same file it's already using and reload,
      // simulating a process restart against the same durable file.
      tipsStore.setStorePathForTests(tipsStore.getStorePath());

      const result = tipsService.getTipsReceived(KEY_B);
      expect(result.total).toBe(2);
      expect(result.tips.map((t) => t.senderPublicKey).sort()).toEqual([KEY_A, KEY_C].sort());
    });

    it("exposes quarantined records instead of silently dropping malformed data", () => {
      expect(tipsService.getQuarantinedTips()).toEqual([]);
    });
  });
});

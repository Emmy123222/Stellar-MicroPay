/**
 * __tests__/tipsStore.test.js
 * Unit tests for the tipsStore.js durable storage engine: schema migration,
 * quarantine of malformed records, atomic persistence, and transactional
 * rollback when a write fails. Business-logic-level pagination/index
 * behavior is covered from tipsService's perspective in tipsService.test.js.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const tipsStore = require("../src/services/tipsStore");

const KEY_A = "G" + "A".repeat(55);
const KEY_B = "G" + "B".repeat(55);

let testDir;
let storePath;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "tips-store-test-"));
  storePath = path.join(testDir, "tips.json");
  tipsStore.setStorePathForTests(storePath);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("tipsStore", () => {
  describe("load()", () => {
    it("starts empty when no store file exists yet", () => {
      expect(tipsStore.getAllByCreator(KEY_B)).toEqual([]);
      expect(tipsStore.getQuarantinedTips()).toEqual([]);
    });

    it("loads records from an existing versioned envelope", () => {
      const envelope = {
        version: 1,
        tips: [
          {
            id: 1,
            senderPublicKey: KEY_A,
            creatorPublicKey: KEY_B,
            amount: "10.0",
            asset: "XLM",
            memo: "",
            txHash: "",
            timestamp: new Date().toISOString(),
          },
        ],
        quarantine: [],
      };
      fs.writeFileSync(storePath, JSON.stringify(envelope), "utf8");

      tipsStore.setStorePathForTests(storePath);

      expect(tipsStore.getAllByCreator(KEY_B)).toHaveLength(1);
      expect(tipsStore.getById(1).senderPublicKey).toBe(KEY_A);
    });

    it("migrates a legacy bare-array dev fixture into the versioned envelope", () => {
      const legacyFixture = [
        {
          id: 1,
          senderPublicKey: KEY_A,
          creatorPublicKey: KEY_B,
          amount: "10.0",
          timestamp: new Date().toISOString(),
        },
        {
          id: 2,
          senderPublicKey: KEY_B,
          creatorPublicKey: KEY_A,
          amount: "5.0",
          timestamp: new Date().toISOString(),
        },
      ];
      fs.writeFileSync(storePath, JSON.stringify(legacyFixture), "utf8");

      tipsStore.setStorePathForTests(storePath);

      // Both legacy records were migrated and are queryable through the indexes.
      expect(tipsStore.getAllByCreator(KEY_B)).toHaveLength(1);
      expect(tipsStore.getAllByCreator(KEY_A)).toHaveLength(1);

      // Missing optional fields were normalized to their defaults.
      expect(tipsStore.getById(1).asset).toBe("XLM");
      expect(tipsStore.getById(1).memo).toBe("");
      expect(tipsStore.getById(1).txHash).toBe("");

      // The file on disk was rewritten in the current versioned envelope so
      // future loads skip the migration step.
      const onDisk = JSON.parse(fs.readFileSync(storePath, "utf8"));
      expect(onDisk.version).toBe(1);
      expect(onDisk.tips).toHaveLength(2);
    });

    it("quarantines malformed entries instead of dropping them or crashing", () => {
      const mixedFixture = [
        {
          id: 1,
          senderPublicKey: KEY_A,
          creatorPublicKey: KEY_B,
          amount: "10.0",
          timestamp: new Date().toISOString(),
        },
        { id: "not-a-number", amount: "5.0" }, // malformed: id not an integer
        { senderPublicKey: KEY_A }, // malformed: missing creatorPublicKey/amount/timestamp
        "just a string", // malformed: not an object
      ];
      fs.writeFileSync(storePath, JSON.stringify(mixedFixture), "utf8");

      tipsStore.setStorePathForTests(storePath);

      expect(tipsStore.getAllByCreator(KEY_B)).toHaveLength(1);
      expect(tipsStore.getQuarantinedTips()).toHaveLength(3);
      expect(tipsStore.getQuarantinedTips()[0]).toEqual(
        expect.objectContaining({ reason: "malformed tip record" })
      );
    });

    it("starts empty (rather than crashing) when the store file contains invalid JSON", () => {
      fs.writeFileSync(storePath, "{not valid json", "utf8");

      tipsStore.setStorePathForTests(storePath);

      expect(tipsStore.getAllByCreator(KEY_B)).toEqual([]);
    });
  });

  describe("insert()", () => {
    it("indexes a new tip by both creator and sender", () => {
      const tip = {
        id: tipsStore.nextTipId(),
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        asset: "XLM",
        memo: "",
        txHash: "",
        timestamp: new Date().toISOString(),
      };

      tipsStore.insert(tip);

      expect(tipsStore.getAllByCreator(KEY_B)).toEqual([tip]);
      expect(tipsStore.getAllBySender(KEY_A)).toEqual([tip]);
      expect(tipsStore.getById(tip.id)).toEqual(tip);
    });

    it("persists atomically: the on-disk file is always valid JSON, never a partial write", () => {
      for (let i = 0; i < 5; i++) {
        tipsStore.insert({
          id: tipsStore.nextTipId(),
          senderPublicKey: KEY_A,
          creatorPublicKey: KEY_B,
          amount: `${i + 1}.0`,
          asset: "XLM",
          memo: "",
          txHash: "",
          timestamp: new Date().toISOString(),
        });
      }

      const onDisk = JSON.parse(fs.readFileSync(storePath, "utf8"));
      expect(onDisk.tips).toHaveLength(5);
      // No leftover temp files from the write-temp-then-rename sequence.
      const leftoverTmp = fs.readdirSync(testDir).filter((f) => f.includes(".tmp"));
      expect(leftoverTmp).toEqual([]);
    });

    it("rolls back the in-memory index when the disk write fails (transactional insert)", () => {
      const fsModule = require("fs");
      jest.spyOn(fsModule, "writeFileSync").mockImplementation(() => {
        throw new Error("simulated disk full");
      });

      const tip = {
        id: tipsStore.nextTipId(),
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        asset: "XLM",
        memo: "",
        txHash: "",
        timestamp: new Date().toISOString(),
      };

      expect(() => tipsStore.insert(tip)).toThrow("simulated disk full");

      // In-memory state was rolled back — no half-recorded tip left behind.
      expect(tipsStore.getById(tip.id)).toBeUndefined();
      expect(tipsStore.getAllByCreator(KEY_B)).toEqual([]);
      expect(tipsStore.getAllBySender(KEY_A)).toEqual([]);
    });
  });

  describe("resetStore()", () => {
    it("clears all records and indexes", () => {
      tipsStore.insert({
        id: tipsStore.nextTipId(),
        senderPublicKey: KEY_A,
        creatorPublicKey: KEY_B,
        amount: "10.0",
        asset: "XLM",
        memo: "",
        txHash: "",
        timestamp: new Date().toISOString(),
      });

      tipsStore.resetStore();

      expect(tipsStore.getAllByCreator(KEY_B)).toEqual([]);
      expect(tipsStore.nextTipId()).toBe(1); // id sequence restarts too
    });
  });
});

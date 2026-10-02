/**
 * __tests__/tips.test.js
 * Unit and integration tests for the tips service and endpoints.
 */

"use strict";

const request = require("supertest");
// The rate limiter keeps a process-global store shared by every spec
// file, so lift the cap here rather than have unrelated specs
// exhaust each other's budget.
process.env.RATE_LIMIT_MAX = "10000";
process.env.STRICT_RATE_LIMIT_MAX = "10000";

const app = require("../src/server");
const tipsService = require("../src/services/tipsService");
const tipsController = require("../src/controllers/tipsController");

const CREATOR_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CREATOR_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const SENDER = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

describe("tipsService", () => {
  describe("validateTipInput", () => {
    it("accepts a well-formed tip", () => {
      expect(() =>
        tipsService.validateTipInput({
          senderPublicKey: SENDER,
          creatorPublicKey: CREATOR_A,
          amount: "10",
        })
      ).not.toThrow();
    });

    it("rejects a missing sender public key", () => {
      expect(() =>
        tipsService.validateTipInput({ creatorPublicKey: CREATOR_A, amount: "10" })
      ).toThrow("senderPublicKey is required");
    });

    it("rejects a malformed sender public key", () => {
      expect(() =>
        tipsService.validateTipInput({
          senderPublicKey: "nope",
          creatorPublicKey: CREATOR_A,
          amount: "10",
        })
      ).toThrow("Invalid sender public key format");
    });

    it("rejects a malformed creator public key", () => {
      expect(() =>
        tipsService.validateTipInput({
          senderPublicKey: SENDER,
          creatorPublicKey: "nope",
          amount: "10",
        })
      ).toThrow("Invalid creator public key format");
    });

    it("rejects a missing amount", () => {
      expect(() =>
        tipsService.validateTipInput({
          senderPublicKey: SENDER,
          creatorPublicKey: CREATOR_A,
        })
      ).toThrow("amount is required");
    });

    it("rejects a zero amount", () => {
      expect(() =>
        tipsService.validateTipInput({
          senderPublicKey: SENDER,
          creatorPublicKey: CREATOR_A,
          amount: "0",
        })
      ).toThrow("amount must be a positive number");
    });

    it("rejects a negative amount", () => {
      expect(() =>
        tipsService.validateTipInput({
          senderPublicKey: SENDER,
          creatorPublicKey: CREATOR_A,
          amount: "-5",
        })
      ).toThrow("amount must be a positive number");
    });

    it("rejects a non-numeric amount", () => {
      expect(() =>
        tipsService.validateTipInput({
          senderPublicKey: SENDER,
          creatorPublicKey: CREATOR_A,
          amount: "abc",
        })
      ).toThrow("amount must be a positive number");
    });

    it("reports every validation failure at once", () => {
      expect(() => tipsService.validateTipInput({})).toThrow(
        "senderPublicKey is required, creatorPublicKey is required, amount is required"
      );
    });
  });

  describe("getLeaderboard", () => {
    beforeAll(() => {
      tipsService.recordTip({
        senderPublicKey: SENDER,
        creatorPublicKey: CREATOR_A,
        amount: "10",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: SENDER,
        creatorPublicKey: CREATOR_A,
        amount: "5",
        asset: "XLM",
      });
      tipsService.recordTip({
        senderPublicKey: SENDER,
        creatorPublicKey: CREATOR_B,
        amount: "100",
        asset: "XLM",
      });
    });

    it("ranks creators by total amount tipped, descending", () => {
      const { entries } = tipsService.getLeaderboard();

      expect(entries[0].creatorPublicKey).toBe(CREATOR_B);
      expect(entries[0].totalAmount).toBe("100");
      expect(entries[1].creatorPublicKey).toBe(CREATOR_A);
      expect(entries[1].totalAmount).toBe("15");
      expect(entries[1].totalTips).toBe(2);
    });

    it("honours the limit option", () => {
      const { entries, limit } = tipsService.getLeaderboard({ limit: 1 });

      expect(entries).toHaveLength(1);
      expect(limit).toBe(1);
    });

    it("defaults to ten entries", () => {
      expect(tipsService.getLeaderboard().limit).toBe(10);
    });

    it("reports the total number of creators with tips", () => {
      expect(tipsService.getLeaderboard().totalCreators).toBe(2);
    });

    it("aggregates totals per asset", () => {
      const { entries } = tipsService.getLeaderboard();
      const creatorA = entries.find((e) => e.creatorPublicKey === CREATOR_A);

      expect(creatorA.totalByAsset.XLM.count).toBe(2);
      expect(creatorA.totalByAsset.XLM.amount).toBe("15");
    });
  });
});

describe("Tips API", () => {
  describe("GET /api/tips/leaderboard", () => {
    it("returns the leaderboard", async () => {
      const response = await request(app).get("/api/tips/leaderboard").expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("entries");
      expect(response.body.data).toHaveProperty("totalCreators");
    });

    it("does not treat leaderboard as a creator public key", async () => {
      // Guards the route ordering: "leaderboard" must not be captured by a
      // ":creatorPublicKey" pattern and rejected as a malformed key.
      const response = await request(app).get("/api/tips/leaderboard").expect(200);

      expect(response.body).not.toHaveProperty("error");
    });

    it("rejects a non-numeric limit", async () => {
      const response = await request(app)
        .get("/api/tips/leaderboard?limit=abc")
        .expect(400);

      expect(response.body).toHaveProperty("error", "limit must be a positive integer");
    });

    it("rejects a zero limit", async () => {
      const response = await request(app)
        .get("/api/tips/leaderboard?limit=0")
        .expect(400);

      expect(response.body).toHaveProperty("error", "limit must be a positive integer");
    });

    it("rejects a negative limit", async () => {
      const response = await request(app)
        .get("/api/tips/leaderboard?limit=-5")
        .expect(400);

      expect(response.body).toHaveProperty("error", "limit must be a positive integer");
    });

    // `parseInt` would coerce all of these instead of rejecting them, which
    // is why the controller validates the whole value rather than its prefix.
    it.each([
      ["trailing garbage", "1abc"],
      ["a fractional value", "1.9"],
      ["a bare fraction", "0.5"],
      ["exponent notation", "1e3"],
      ["hex notation", "0x10"],
      ["a trailing space only", " "],
      ["an empty value", ""],
      ["Infinity", "Infinity"],
    ])("rejects a limit that is %s", async (_label, value) => {
      const response = await request(app)
        .get(`/api/tips/leaderboard?limit=${encodeURIComponent(value)}`)
        .expect(400);

      expect(response.body).toHaveProperty("error", "limit must be a positive integer");
    });

    it("rejects a repeated limit parameter", async () => {
      const response = await request(app)
        .get("/api/tips/leaderboard?limit=1&limit=2")
        .expect(400);

      expect(response.body).toHaveProperty("error", "limit must be a positive integer");
    });

    it("accepts a valid limit, with surrounding whitespace tolerated", async () => {
      const response = await request(app)
        .get("/api/tips/leaderboard?limit=%205%20")
        .expect(200);

      expect(response.body.data.limit).toBe(5);
    });
  });

  // `parseInt` fed these straight into Array.prototype.slice, so
  // `?limit=abc` returned an empty page and `?limit=-5` applied negative
  // index semantics ? all with a 200.
  //
  // The input matrix is asserted against the parser directly rather than over
  // HTTP: the suite shares a 100-request-per-IP limiter, and 20-odd extra
  // requests here would exhaust the budget for the whole file. The three
  // routes below then prove the parser is actually wired to each one.
  describe("parsePaginationParam", () => {
    const { parsePaginationParam } = tipsController;

    it.each([
      ["abc", "a non-numeric limit"],
      ["1abc", "a limit with trailing characters"],
      ["1.9", "a fractional limit"],
      ["-5", "a negative limit"],
      ["0", "a zero limit"],
      ["1e3", "exponent notation"],
      ["0x10", "hex notation"],
      ["", "an empty value"],
      [" ", "whitespace only"],
      ["Infinity", "Infinity"],
      ["NaN", "NaN"],
    ])("rejects %s (%s) as a limit", (value) => {
      expect(() => parsePaginationParam(value, { name: "limit", min: 1 })).toThrow(
        "limit must be a positive integer"
      );
    });

    it.each([["abc"], ["-1"], ["1.9"], ["-0"]])(
      "rejects %s as an offset",
      (value) => {
        expect(() => parsePaginationParam(value, { name: "offset", min: 0 })).toThrow(
          "offset must be a non-negative integer"
        );
      }
    );

    it("rejects a repeated parameter, which arrives as an array", () => {
      expect(() => parsePaginationParam(["1", "2"], { name: "limit", min: 1 })).toThrow(
        "limit must be a positive integer"
      );
    });

    it.each([
      ["5", 5],
      [" 5 ", 5],
      ["1", 1],
      ["999", 999],
    ])("accepts %s", (value, expected) => {
      expect(parsePaginationParam(value, { name: "limit", min: 1 })).toBe(expected);
    });

    it("returns undefined when the parameter is absent", () => {
      expect(parsePaginationParam(undefined, { name: "limit", min: 1 })).toBeUndefined();
    });

    it("accepts zero for offset but not for limit", () => {
      expect(parsePaginationParam("0", { name: "offset", min: 0 })).toBe(0);
      expect(() => parsePaginationParam("0", { name: "limit", min: 1 })).toThrow();
    });

    it("sets status 400 on the thrown error", () => {
      try {
        parsePaginationParam("abc", { name: "limit", min: 1 });
        throw new Error("expected a throw");
      } catch (err) {
        expect(err.status).toBe(400);
      }
    });
  });

  describe("pagination wiring on the received and sent routes", () => {
    it("rejects a malformed limit on GET /received", async () => {
      const response = await request(app)
        .get(`/api/tips/received/${CREATOR_A}?limit=abc`)
        .expect(400);

      expect(response.body.error).toBe("limit must be a positive integer");
    });

    it("rejects a negative offset on GET /sent", async () => {
      const response = await request(app)
        .get(`/api/tips/sent/${SENDER}?offset=-1`)
        .expect(400);

      expect(response.body.error).toBe("offset must be a non-negative integer");
    });

    it("applies a valid limit and offset together on GET /received", async () => {
      const response = await request(app)
        .get(`/api/tips/received/${CREATOR_A}?limit=1&offset=1`)
        .expect(200);

      expect(response.body.data.tips).toHaveLength(1);
      expect(response.body.data.limit).toBe(1);
      expect(response.body.data.offset).toBe(1);
    });

    it("allows a zero offset, which is not an error", async () => {
      const response = await request(app)
        .get(`/api/tips/received/${CREATOR_A}?offset=0`)
        .expect(200);

      expect(response.body.data.offset).toBe(0);
      expect(response.body.data.tips.length).toBeGreaterThan(0);
    });
  });

  describe("POST /api/tips", () => {
    it("rejects a malformed sender public key", async () => {
      const response = await request(app)
        .post("/api/tips")
        .send({ senderPublicKey: "nope", creatorPublicKey: CREATOR_A, amount: "5" })
        .expect(400);

      expect(response.body.error).toContain("Invalid sender public key format");
    });

    it("rejects a non-positive amount", async () => {
      const response = await request(app)
        .post("/api/tips")
        .send({ senderPublicKey: SENDER, creatorPublicKey: CREATOR_A, amount: "-1" })
        .expect(400);

      expect(response.body.error).toContain("amount must be a positive number");
    });

    it("records a valid tip", async () => {
      const response = await request(app)
        .post("/api/tips")
        .send({ senderPublicKey: SENDER, creatorPublicKey: CREATOR_A, amount: "7" })
        .expect(201);

      expect(response.body).toHaveProperty("success", true);
    });
  });
});

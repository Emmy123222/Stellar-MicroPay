/**
 * __tests__/paymentLimits.test.js
 * Dust-payment floor: unit coverage of the rule itself (#1209), then the same
 * rule as POST /api/tips actually returns it.
 */

"use strict";

const request = require("supertest");
const app = require("../src/server");
const {
  STROOPS_PER_XLM,
  MIN_PAYMENT_STROOPS,
  MIN_PAYMENT_XLM,
  MIN_PAYMENT_ERROR,
  toStroops,
  isDustAmount,
  assertNotDust,
} = require("../src/services/paymentLimits");
const tipsService = require("../src/services/tipsService");

const SENDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CREATOR = "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVTK";

describe("payment floor constants", () => {
  it("is 1000 stroops, i.e. 0.0001 XLM", () => {
    expect(STROOPS_PER_XLM).toBe(10_000_000);
    expect(MIN_PAYMENT_STROOPS).toBe(1_000);
    expect(MIN_PAYMENT_XLM).toBe(0.0001);
  });

  it("is ten times the network base fee", () => {
    // The floor exists because a payment has to beat the fee that settles it.
    expect(MIN_PAYMENT_STROOPS).toBe(10 * 100);
  });

  it("states the minimum the same way the message reads it", () => {
    expect(MIN_PAYMENT_ERROR).toBe("Amount too small — minimum payment is 0.0001 XLM");
  });
});

describe("toStroops", () => {
  it("accepts numbers and Horizon-style strings alike", () => {
    expect(toStroops(1)).toBe(10_000_000);
    expect(toStroops("1")).toBe(10_000_000);
    expect(toStroops("0.5")).toBe(5_000_000);
    expect(toStroops(" 0.5 ")).toBe(5_000_000);
  });

  it("does not lose the boundary to floating point", () => {
    // 0.0001 * 10_000_000 is 999.9999... before rounding.
    expect(toStroops("0.0001")).toBe(1_000);
    expect(toStroops(0.0001)).toBe(1_000);
  });

  it("returns null for anything that is not an amount", () => {
    expect(toStroops("")).toBeNull();
    expect(toStroops("abc")).toBeNull();
    expect(toStroops(undefined)).toBeNull();
    expect(toStroops(null)).toBeNull();
    expect(toStroops(NaN)).toBeNull();
  });
});

describe("isDustAmount", () => {
  it("treats the boundary value as payable, not dust", () => {
    expect(isDustAmount("0.0001")).toBe(false);
    expect(isDustAmount(0.0001)).toBe(false);
    expect(toStroops("0.0001")).toBe(MIN_PAYMENT_STROOPS);
  });

  it("rejects one stroop under the boundary", () => {
    expect(isDustAmount("0.0000999")).toBe(true);
    expect(toStroops("0.0000999")).toBe(999);
  });

  it("rounds sub-stroop precision the way the network itself does", () => {
    // Amounts carry 7 decimals; anything finer is the caller's rounding error,
    // not a smaller payment.
    expect(toStroops("0.0000999999")).toBe(1_000);
    expect(isDustAmount("0.0000999999")).toBe(false);
  });

  it("rejects the classic dust sizes", () => {
    expect(isDustAmount("0.00001")).toBe(true);
    expect(isDustAmount("1e-7")).toBe(true);
    expect(isDustAmount(0.0000999)).toBe(true);
  });

  it("accepts comfortably larger amounts", () => {
    expect(isDustAmount("0.0002")).toBe(false);
    expect(isDustAmount("1.5")).toBe(false);
    expect(isDustAmount("1000000")).toBe(false);
  });

  it("leaves missing amounts to the required-field check", () => {
    // Otherwise "amount is required" and "amount too small" fire together and
    // the client gets a message that describes the wrong problem.
    expect(isDustAmount("")).toBe(false);
    expect(isDustAmount(undefined)).toBe(false);
    expect(isDustAmount("not-a-number")).toBe(false);
  });
});

describe("assertNotDust", () => {
  it("throws a 400 carrying exactly the documented message", () => {
    expect(() => assertNotDust("0.00001")).toThrow(MIN_PAYMENT_ERROR);
    try {
      assertNotDust("0.00001");
    } catch (error) {
      expect(error.status).toBe(400);
    }
  });

  it("lets the boundary value through", () => {
    expect(() => assertNotDust("0.0001")).not.toThrow();
  });
});

describe("tipsService.validateTipInput", () => {
  const base = { senderPublicKey: SENDER, creatorPublicKey: CREATOR };

  it("rejects a dust amount with the floor message", () => {
    expect(() => tipsService.validateTipInput({ ...base, amount: "0.00005" })).toThrow(
      MIN_PAYMENT_ERROR
    );
  });

  it("still reports a missing amount as missing, not as dust", () => {
    expect(() => tipsService.validateTipInput({ ...base, amount: "" })).toThrow(
      "amount is required"
    );
  });

  it("still reports a non-positive amount as such", () => {
    expect(() => tipsService.validateTipInput({ ...base, amount: "0" })).toThrow(
      "amount must be a positive number"
    );
    expect(() => tipsService.validateTipInput({ ...base, amount: "-1" })).toThrow(
      "amount must be a positive number"
    );
  });

  it("accepts the smallest payable tip", () => {
    expect(tipsService.validateTipInput({ ...base, amount: "0.0001" })).toBe(true);
  });

  it("refuses to record a dust tip even without the HTTP layer", () => {
    expect(() =>
      tipsService.recordTip({
        senderPublicKey: SENDER,
        creatorPublicKey: CREATOR,
        amount: "0.00001",
      })
    ).toThrow(MIN_PAYMENT_ERROR);
  });
});

describe("POST /api/tips dust rejection", () => {
  function post(body) {
    return request(app).post("/api/tips").set("Accept", "application/json").send(body);
  }

  it("answers a dust amount with 400 and the minimum payment message", async () => {
    const response = await post({
      senderPublicKey: SENDER,
      creatorPublicKey: CREATOR,
      amount: "0.00001",
      asset: "XLM",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Amount too small — minimum payment is 0.0001 XLM");
  });

  it("accepts a payment at exactly the minimum", async () => {
    const response = await post({
      senderPublicKey: SENDER,
      creatorPublicKey: CREATOR,
      amount: "0.0001",
      asset: "XLM",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.amount).toBe("0.0001");
  });

  it("rejects before anything is stored", async () => {
    const before = await post({
      senderPublicKey: SENDER,
      creatorPublicKey: CREATOR,
      amount: "0.0000999",
      asset: "XLM",
    });
    expect(before.status).toBe(400);

    const received = await request(app).get(`/api/tips/received/${CREATOR}`);
    const recorded = received.body.data.tips || [];
    expect(recorded.some((tip) => Number(tip.amount) < MIN_PAYMENT_XLM)).toBe(false);
  });

  it("answers a normal amount the same as before the floor existed", async () => {
    const response = await post({
      senderPublicKey: SENDER,
      creatorPublicKey: CREATOR,
      amount: "2.5",
      asset: "XLM",
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
  });
});

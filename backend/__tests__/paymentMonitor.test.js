/**
 * __tests__/paymentMonitor.test.js (#773)
 * Verifies durable-cursor resume and replay de-duplication.
 */

"use strict";

var streamOptions = null;
var lastCursorArg = null;

jest.mock("@stellar/stellar-sdk", () => {
  const stream = jest.fn((opts) => {
    streamOptions = opts;
    return jest.fn();
  });
  const cursor = jest.fn((arg) => {
    lastCursorArg = arg;
    return { stream };
  });
  const forAccount = jest.fn(() => ({ cursor }));
  const payments = jest.fn(() => ({ forAccount }));
  return { Horizon: { Server: jest.fn(() => ({ payments })) } };
});

jest.mock("../src/services/webhookStore", () => ({
  getWebhooksByPublicKey: jest.fn().mockReturnValue([]),
  getAllWebhooks: jest.fn().mockReturnValue([]),
}));
jest.mock("../src/services/webhookDelivery", () => ({
  deliverWebhook: jest.fn(),
}));
jest.mock("../src/services/cursorStore", () => ({
  get: jest.fn().mockReturnValue("now"),
  set: jest.fn(),
}));

const { Horizon } = require("@stellar/stellar-sdk");
const { startMonitoring } = require("../src/services/paymentMonitor");
const { getWebhooksByPublicKey } = require("../src/services/webhookStore");
const { deliverWebhook } = require("../src/services/webhookDelivery");
const cursorStore = require("../src/services/cursorStore");

const PUBLIC_KEY = "GA0000000000000000000000000000000000000000000000000000";

function payment(over = {}) {
  return {
    type: "payment",
    to: PUBLIC_KEY,
    amount: "10.0000000",
    asset_type: "native",
    from: "GBFROM0000000000000000000000000000000000000000000000000000",
    transaction_hash: "txhash",
    ledger_attr: 123,
    created_at: new Date().toISOString(),
    paging_token: "003212345678",
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  streamOptions = null;
  lastCursorArg = null;
  cursorStore.get.mockReturnValue("now");
  getWebhooksByPublicKey.mockReturnValue([{ id: "w1", publicKey: PUBLIC_KEY }]);
});

describe("paymentMonitor durable cursor (#773)", () => {
  it("resumes from a persisted cursor instead of always 'now'", () => {
    cursorStore.get.mockReturnValue("003100000000");
    startMonitoring(PUBLIC_KEY);
    expect(lastCursorArg).toBe("003100000000");
  });

  it("falls back to 'now' when no cursor has been persisted", () => {
    startMonitoring(PUBLIC_KEY);
    expect(lastCursorArg).toBe("now");
  });

  it("advances the durable cursor after handling a payment", async () => {
    startMonitoring(PUBLIC_KEY);
    await streamOptions.onmessage(payment({ paging_token: "p1" }));
    expect(cursorStore.set).toHaveBeenCalledWith(PUBLIC_KEY, "p1");
  });

  it("skips a payment replayed at the last persisted cursor", async () => {
    cursorStore.get.mockReturnValue("p1");
    startMonitoring(PUBLIC_KEY);
    await streamOptions.onmessage(payment({ paging_token: "p1" }));
    expect(getWebhooksByPublicKey).not.toHaveBeenCalled();
    expect(deliverWebhook).not.toHaveBeenCalled();
  });

  it("de-duplicates repeated paging tokens within one stream", async () => {
    startMonitoring(PUBLIC_KEY);
    await streamOptions.onmessage(payment({ paging_token: "p2" }));
    await streamOptions.onmessage(payment({ paging_token: "p2" }));
    expect(deliverWebhook).toHaveBeenCalledTimes(1);
  });
});

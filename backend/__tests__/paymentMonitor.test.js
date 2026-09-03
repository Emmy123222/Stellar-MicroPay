/**
 * Payment monitor (#770): the Horizon stream callback must enqueue webhook
 * deliveries into the bounded queue without performing any network I/O inline.
 */
"use strict";

let mockStreamOptions = null;
let mockStreamCalls = 0;
let mockCloseStreamFn = null;

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: (opts) => {
              mockStreamCalls += 1;
              mockStreamOptions = opts;
              mockCloseStreamFn = jest.fn();
              return mockCloseStreamFn;
            },
          }),
        }),
      }),
    })),
  },
}));

jest.mock("../src/services/webhookQueue", () => ({
  enqueueDelivery: jest.fn(),
}));

jest.mock("../src/services/webhookDelivery", () => ({
  deliverWebhook: jest.fn(),
}));

const ACCOUNT_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const ACCOUNT_B = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";
const ACCOUNT_C = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

let monitor;
let enqueueDelivery;
let deliverWebhook;
let registerWebhook;

/**
 * Fresh module instances per test so the in-memory webhook store and the
 * mock call counts never leak between tests.
 */
function loadMonitor() {
  jest.resetModules();
  monitor = require("../src/services/paymentMonitor");
  ({ enqueueDelivery } = require("../src/services/webhookQueue"));
  ({ deliverWebhook } = require("../src/services/webhookDelivery"));
  ({ registerWebhook } = require("../src/services/webhookStore"));
}

function paymentRecord(overrides = {}) {
  return {
    type: "payment",
    to: ACCOUNT_A,
    from: ACCOUNT_B,
    amount: "1.0000000",
    asset_type: "native",
    transaction_hash: "abc123",
    ledger_attr: 42,
    created_at: "2026-08-28T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockStreamCalls = 0;
  mockStreamOptions = null;
  mockCloseStreamFn = null;
  loadMonitor();
});

afterEach(() => {
  monitor.stopMonitoring(ACCOUNT_A);
  monitor.stopMonitoring(ACCOUNT_B);
});

describe("paymentMonitor", () => {
  it("enqueues a delivery for each registered webhook without awaiting it", () => {
    const hookA = registerWebhook(ACCOUNT_A, "https://x.test/a", "secret-a");
    const hookB = registerWebhook(ACCOUNT_A, "https://x.test/b", "secret-b");

    monitor.startMonitoring(ACCOUNT_A);
    mockStreamOptions.onmessage(paymentRecord()); // synchronous — no await

    expect(enqueueDelivery).toHaveBeenCalledTimes(2);

    const [calledWebhook, calledPayload] = enqueueDelivery.mock.calls[0];
    expect(calledWebhook).toMatchObject({ id: hookA.id, url: hookA.url });
    expect(calledPayload).toEqual({
      event: "payment_received",
      publicKey: ACCOUNT_A,
      amount: "1.0000000",
      asset: "native",
      from: ACCOUNT_B,
      transactionHash: "abc123",
      ledger: 42,
      timestamp: "2026-08-28T00:00:00Z",
    });
    expect(enqueueDelivery.mock.calls[1][0].id).toBe(hookB.id);

    // The heavy HTTP work must happen in the queue, never on the stream path
    expect(deliverWebhook).not.toHaveBeenCalled();
  });

  it("ignores non-payment operations and payments to other accounts", () => {
    registerWebhook(ACCOUNT_A, "https://x.test/a", "secret-a");
    monitor.startMonitoring(ACCOUNT_A);

    mockStreamOptions.onmessage(paymentRecord({ type: "create_account" }));
    mockStreamOptions.onmessage(paymentRecord({ to: ACCOUNT_B }));

    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it("maps issued assets to CODE:ISSUER in the payload", () => {
    registerWebhook(ACCOUNT_A, "https://x.test/a", "secret-a");
    monitor.startMonitoring(ACCOUNT_A);

    mockStreamOptions.onmessage(
      paymentRecord({
        asset_type: "credit_alphanum4",
        asset_code: "CODE",
        asset_issuer: ACCOUNT_C,
      })
    );

    expect(enqueueDelivery).toHaveBeenCalledTimes(1);
    expect(enqueueDelivery.mock.calls[0][1].asset).toBe(`CODE:${ACCOUNT_C}`);
  });

  it("defaults the ledger to 0 when Horizon omits ledger_attr", () => {
    registerWebhook(ACCOUNT_A, "https://x.test/a", "secret-a");
    monitor.startMonitoring(ACCOUNT_A);

    const record = paymentRecord();
    delete record.ledger_attr;
    mockStreamOptions.onmessage(record);

    expect(enqueueDelivery).toHaveBeenCalledTimes(1);
    expect(enqueueDelivery.mock.calls[0][1].ledger).toBe(0);
  });

  it("does not start a second stream for the same account", () => {
    registerWebhook(ACCOUNT_A, "https://x.test/a", "secret-a");

    monitor.startMonitoring(ACCOUNT_A);
    monitor.startMonitoring(ACCOUNT_A); // idempotent

    expect(mockStreamCalls).toBe(1);
  });

  it("restarts the stream after a stream error", () => {
    registerWebhook(ACCOUNT_A, "https://x.test/a", "secret-a");

    monitor.startMonitoring(ACCOUNT_A);
    mockStreamOptions.onerror(new Error("connection reset"));
    monitor.startMonitoring(ACCOUNT_A); // ensureMonitored can revive it

    expect(mockStreamCalls).toBe(2);
  });

  it("closes the underlying stream on stopMonitoring", () => {
    registerWebhook(ACCOUNT_A, "https://x.test/a", "secret-a");

    monitor.startMonitoring(ACCOUNT_A);
    expect(mockCloseStreamFn).not.toHaveBeenCalled();

    monitor.stopMonitoring(ACCOUNT_A);
    expect(mockCloseStreamFn).toHaveBeenCalledTimes(1);

    // starting again opens a fresh stream instead of reusing the closed one
    monitor.startMonitoring(ACCOUNT_A);
    expect(mockStreamCalls).toBe(2);
  });

  it("resumes monitors for every distinct registered account", () => {
    registerWebhook(ACCOUNT_A, "https://x.test/a", "secret-a");
    registerWebhook(ACCOUNT_B, "https://x.test/b", "secret-b");
    registerWebhook(ACCOUNT_A, "https://x.test/a2", "secret-a2"); // same account

    monitor.resumeAllMonitors();

    expect(mockStreamCalls).toBe(2); // ACCOUNT_A and ACCOUNT_B only
  });
});
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
const { startMonitoring, stopMonitoring } = require("../src/services/paymentMonitor");
const { getWebhooksByPublicKey } = require("../src/services/webhookStore");
const { deliverWebhook } = require("../src/services/webhookDelivery");
const cursorStore = require("../src/services/cursorStore");
const { getBreaker, resetAllBreakers } = require("../src/services/horizonCircuitBreaker");

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
  stopMonitoring(PUBLIC_KEY);
  jest.clearAllMocks();
  resetAllBreakers();
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

describe("paymentMonitor Horizon circuit breaker (#840)", () => {
  it("does not start a stream while the circuit is open", () => {
    const breaker = getBreaker("https://horizon-testnet.stellar.org", { failureThreshold: 1 });
    breaker.recordFailure();

    const result = startMonitoring(PUBLIC_KEY);

    expect(result.started).toBe(false);
    expect(result.state).toBe("open");
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(0);
    expect(streamOptions).toBeNull();
  });

  it("records stream errors against the breaker", () => {
    const breaker = getBreaker("https://horizon-testnet.stellar.org", { failureThreshold: 1 });
    startMonitoring(PUBLIC_KEY);

    streamOptions.onerror(new Error("upstream unavailable"));

    expect(breaker.state).toBe("open");
  });
});

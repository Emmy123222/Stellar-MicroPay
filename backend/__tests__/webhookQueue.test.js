/**
 * Webhook delivery queue (#770): enqueue outside the stream callback,
 * bounded exponential retries with jitter, dead-letter state, and
 * last-delivery-status exposure.
 */
"use strict";

jest.mock("../src/services/webhookDelivery", () => ({
  deliverWebhook: jest.fn(),
}));

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

const ACCOUNT_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const ACCOUNT_B = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

const BASE_ENV = {
  WEBHOOK_RETRY_BASE_DELAY_MS: "5",
  WEBHOOK_RETRY_MAX_DELAY_MS: "10",
  WEBHOOK_MAX_ATTEMPTS: "3",
  WEBHOOK_QUEUE_MAX_SIZE: "10",
  WEBHOOK_MAX_CONCURRENT: "5",
  WEBHOOK_DLQ_MAX_SIZE: "10",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) return false;
    await sleep(10);
  }
  return true;
}

/**
 * Load a fresh queue module instance (config is read at require time).
 * Returns the queue, the mocked deliverWebhook, and a fresh webhook store.
 */
function loadQueue(env = {}) {
  jest.resetModules();
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...env })) {
    process.env[key] = value;
  }
  const queue = require("../src/services/webhookQueue");
  const { deliverWebhook } = require("../src/services/webhookDelivery");
  const { registerWebhook, deleteWebhook } = require("../src/services/webhookStore");
  return { queue, deliverWebhook, registerWebhook, deleteWebhook };
}

function payload(overrides = {}) {
  return {
    event: "payment_received",
    publicKey: ACCOUNT_A,
    amount: "10.0000000",
    asset: "native",
    from: ACCOUNT_B,
    transactionHash: "tx-default",
    ledger: 123,
    timestamp: "2026-08-28T00:00:00Z",
    ...overrides,
  };
}

const OK = { ok: true, httpStatus: 200, error: null };
const fail = (status) => ({ ok: false, httpStatus: status, error: `HTTP ${status}` });

describe("webhook delivery queue", () => {
  it("delivers enqueued payments asynchronously and exposes the delivered status", async () => {
    const { queue, deliverWebhook, registerWebhook } = loadQueue();
    deliverWebhook.mockResolvedValue(OK);

    const hook = registerWebhook(ACCOUNT_A, "https://x.test/hook", "secret-a");
    const result = queue.enqueueDelivery(hook, payload({ transactionHash: "tx-1" }));

    // Enqueue is synchronous and non-blocking — nothing delivered yet
    expect(result).toMatchObject({ enqueued: true, id: `${hook.id}:tx-1` });
    expect(deliverWebhook).not.toHaveBeenCalled();

    await sleep(20);

    expect(deliverWebhook).toHaveBeenCalledTimes(1);
    expect(deliverWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ id: hook.id, url: hook.url }),
      expect.objectContaining({ transactionHash: "tx-1" })
    );

    const status = queue.getDeliveryStatus(hook.id);
    expect(status).toMatchObject({
      webhookId: hook.id,
      transactionHash: "tx-1",
      state: "delivered",
      attempts: 1,
      lastHttpStatus: 200,
    });
    expect(status.deliveredAt).toBeTruthy();
    expect(queue.getQueueStats()).toMatchObject({ pending: 0, inFlight: 0 });
    expect(queue.getQueueStats().totals.delivered).toBe(1);
  });

  it("retries failed deliveries with backoff until they succeed", async () => {
    const { queue, deliverWebhook, registerWebhook } = loadQueue();
    deliverWebhook
      .mockResolvedValueOnce(fail(429))
      .mockResolvedValueOnce(fail(500))
      .mockResolvedValue(OK);

    const hook = registerWebhook(ACCOUNT_A, "https://x.test/hook", "secret-a");
    queue.enqueueDelivery(hook, payload({ transactionHash: "tx-retry" }));

    expect(await waitFor(() => deliverWebhook.mock.calls.length === 3)).toBe(
      true
    );

    expect(deliverWebhook).toHaveBeenCalledTimes(3);
    expect(queue.getDeliveryStatus(hook.id)).toMatchObject({
      state: "delivered",
      attempts: 3,
      lastHttpStatus: 200,
      lastError: null,
    });
  });

  it("retries network errors the same way as HTTP failures", async () => {
    const { queue, deliverWebhook, registerWebhook } = loadQueue();
    deliverWebhook
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(OK);

    const hook = registerWebhook(ACCOUNT_A, "https://x.test/hook", "secret-a");
    queue.enqueueDelivery(hook, payload({ transactionHash: "tx-net" }));

    expect(await waitFor(() => deliverWebhook.mock.calls.length === 3)).toBe(
      true
    );

    expect(deliverWebhook).toHaveBeenCalledTimes(3);
    expect(queue.getDeliveryStatus(hook.id).state).toBe("delivered");
  });

  it("moves deliveries to the dead-letter state once retries are exhausted", async () => {
    const { queue, deliverWebhook, registerWebhook } = loadQueue({
      WEBHOOK_MAX_ATTEMPTS: "2",
    });
    deliverWebhook.mockResolvedValue(fail(503));

    const hook = registerWebhook(ACCOUNT_A, "https://x.test/hook", "secret-a");
    queue.enqueueDelivery(hook, payload({ transactionHash: "tx-dl" }));

    expect(await waitFor(() => queue.getDeadLetterEntries().length === 1)).toBe(
      true
    );

    expect(deliverWebhook).toHaveBeenCalledTimes(2); // bounded retries

    const status = queue.getDeliveryStatus(hook.id);
    expect(status).toMatchObject({
      state: "dead_letter",
      attempts: 2,
      lastHttpStatus: 503,
      lastError: "HTTP 503",
    });

    const entries = queue.getDeadLetterEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ webhookId: hook.id, state: "dead_letter" });
    expect(entries[0]).not.toHaveProperty("secret");
    expect(queue.getQueueStats()).toMatchObject({ deadLetter: 1 });
    expect(queue.getQueueStats().totals.deadLettered).toBe(1);
  });

  it("can requeue a dead-lettered delivery with a fresh retry budget", async () => {
    const { queue, deliverWebhook, registerWebhook } = loadQueue({
      WEBHOOK_MAX_ATTEMPTS: "1",
    });
    deliverWebhook.mockResolvedValueOnce(fail(500)).mockResolvedValue(OK);

    const hook = registerWebhook(ACCOUNT_A, "https://x.test/hook", "secret-a");
    queue.enqueueDelivery(hook, payload({ transactionHash: "tx-rq" }));
    await sleep(20);

    const entry = queue.getDeadLetterEntries()[0];
    expect(entry).toBeDefined();

    expect(queue.requeueDeadLetter(entry.id)).toBe(true);
    expect(queue.requeueDeadLetter("missing:tx")).toBe(false);

    await sleep(20);

    expect(deliverWebhook).toHaveBeenCalledTimes(2);
    expect(queue.getDeliveryStatus(hook.id)).toMatchObject({
      state: "delivered",
      attempts: 1, // budget was reset
    });
    expect(queue.getDeadLetterEntries()).toHaveLength(0);
  });

  it("ignores duplicate deliveries for the same webhook and transaction", async () => {
    const { queue, deliverWebhook, registerWebhook } = loadQueue();
    deliverWebhook.mockResolvedValue(OK);

    const hook = registerWebhook(ACCOUNT_A, "https://x.test/hook", "secret-a");
    queue.enqueueDelivery(hook, payload({ transactionHash: "tx-dup" }));
    const again = queue.enqueueDelivery(hook, payload({ transactionHash: "tx-dup" }));

    expect(again).toMatchObject({ enqueued: false, reason: "duplicate" });

    await sleep(20);
    expect(deliverWebhook).toHaveBeenCalledTimes(1);
    expect(queue.getQueueStats().totals.duplicates).toBe(1);
  });

  it("rejects new deliveries when the bounded queue is full", async () => {
    const { queue, deliverWebhook, registerWebhook } = loadQueue({
      WEBHOOK_QUEUE_MAX_SIZE: "1",
      WEBHOOK_MAX_ATTEMPTS: "5",
      WEBHOOK_RETRY_BASE_DELAY_MS: "10000",
      WEBHOOK_RETRY_MAX_DELAY_MS: "10000",
    });
    deliverWebhook.mockResolvedValue(fail(500));

    const hook = registerWebhook(ACCOUNT_A, "https://x.test/hook", "secret-a");

    expect(queue.enqueueDelivery(hook, payload({ transactionHash: "tx-1" })).enqueued).toBe(true);
    await sleep(30); // first attempt fails → entry waits ~10s for its retry

    const rejected = queue.enqueueDelivery(hook, payload({ transactionHash: "tx-2" }));
    expect(rejected).toMatchObject({ enqueued: false, reason: "queue_full" });
    expect(queue.getQueueStats().totals.rejectedQueueFull).toBe(1);
  });

  it("drops deliveries whose webhook was deleted before delivery", async () => {
    const { queue, deliverWebhook, registerWebhook, deleteWebhook } = loadQueue();
    deliverWebhook.mockResolvedValue(OK);

    const hook = registerWebhook(ACCOUNT_A, "https://x.test/hook", "secret-a");
    queue.enqueueDelivery(hook, payload({ transactionHash: "tx-orphan" }));
    deleteWebhook(hook.id); // deleted before the worker picks it up

    await sleep(20);

    expect(deliverWebhook).not.toHaveBeenCalled();
    expect(queue.getQueueStats()).toMatchObject({ pending: 0 });
    expect(queue.getQueueStats().totals.orphaned).toBe(1);
  });

  it("caps in-flight deliveries at the configured concurrency", async () => {
    const { queue, deliverWebhook, registerWebhook } = loadQueue({
      WEBHOOK_MAX_CONCURRENT: "1",
    });
    deliverWebhook.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(OK), 15)
        )
    );

    const hookA = registerWebhook(ACCOUNT_A, "https://x.test/a", "secret-a");
    const hookB = registerWebhook(ACCOUNT_B, "https://x.test/b", "secret-b");
    queue.enqueueDelivery(hookA, payload({ transactionHash: "tx-a" }));
    queue.enqueueDelivery(hookB, payload({ transactionHash: "tx-b" }));

    await sleep(2);
    expect(queue.getQueueStats().inFlight).toBe(1);
    expect(queue.getQueueStats().pending).toBe(1); // second waits for a slot

    await sleep(60);
    expect(deliverWebhook).toHaveBeenCalledTimes(2);
    expect(queue.getDeliveryStatus(hookA.id).state).toBe("delivered");
    expect(queue.getDeliveryStatus(hookB.id).state).toBe("delivered");
  });

  it("grows backoff exponentially, caps it, and jitters within bounds", () => {
    const { queue } = loadQueue({
      WEBHOOK_RETRY_BASE_DELAY_MS: "100",
      WEBHOOK_RETRY_MAX_DELAY_MS: "1000",
    });

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const capped = Math.min(100 * 2 ** (attempt - 1), 1000);
      const delay = queue.computeBackoffMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(capped);
      expect(delay).toBeLessThanOrEqual(capped + Math.floor(capped * 0.2));
    }
  });

  it("returns null as the last delivery status for unknown webhooks", () => {
    const { queue } = loadQueue();
    expect(queue.getDeliveryStatus("does-not-exist")).toBeNull();
  });
});

/**
 * Signed webhook delivery: structured results (never throws) + per-attempt
 * HTTP timeout so slow receivers cannot occupy queue workers (#770).
 */
"use strict";

const { generateWebhookSignature } = require("../src/utils/webhookSignature");

const ORIGINAL_FETCH = global.fetch;

const WEBHOOK = { id: "7", url: "https://x.test/hook", secret: "s3cret-value" };

function payload() {
  return {
    event: "payment_received",
    publicKey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
    amount: "10.0000000",
    asset: "native",
    from: "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX",
    transactionHash: "abc123",
    ledger: 42,
    timestamp: "2026-08-28T00:00:00Z",
  };
}

/** Config is read at require time, so reload the module per test. */
function loadDelivery(env = {}) {
  jest.resetModules();
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  return require("../src/services/webhookDelivery");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  delete process.env.WEBHOOK_DELIVERY_TIMEOUT_MS;
});

describe("deliverWebhook", () => {
  it("POSTs a signed body and returns ok on 2xx", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const { deliverWebhook } = loadDelivery();

    const body = JSON.stringify(payload());
    const result = await deliverWebhook(WEBHOOK, payload());

    expect(result).toEqual({ ok: true, httpStatus: 200, error: null });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(WEBHOOK.url);
    expect(options.method).toBe("POST");
    expect(options.body).toBe(body);
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["X-Webhook-ID"]).toBe(WEBHOOK.id);
    expect(options.headers["X-Stellar-Signature"]).toBe(
      `sha256=${generateWebhookSignature(body, WEBHOOK.secret)}`
    );
  });

  it("reports non-2xx responses as failed without throwing", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const { deliverWebhook } = loadDelivery();

    const result = await deliverWebhook(WEBHOOK, payload());

    expect(result).toEqual({ ok: false, httpStatus: 503, error: "HTTP 503" });
  });

  it("reports network errors as failed without throwing", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const { deliverWebhook } = loadDelivery();

    const result = await deliverWebhook(WEBHOOK, payload());

    expect(result).toEqual({ ok: false, httpStatus: null, error: "ECONNREFUSED" });
  });

  it("aborts attempts that exceed the delivery timeout", async () => {
    let capturedOptions = null;
    global.fetch = jest.fn((_url, options) => {
      capturedOptions = options;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "TimeoutError";
          reject(err);
        });
      });
    });
    const { deliverWebhook } = loadDelivery({ WEBHOOK_DELIVERY_TIMEOUT_MS: "5" });

    const result = await deliverWebhook(WEBHOOK, payload());
    await sleep(20); // let the abort signal settle

    expect(capturedOptions.signal).toBeInstanceOf(AbortSignal);
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBeNull();
  });
});

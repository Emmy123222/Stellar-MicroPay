/**
 * Webhook registry and signed delivery.
 */
"use strict";

// Capture the mock close function so tests can assert it was called.
const mockClose = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: () => mockClose,
          }),
        }),
      }),
    })),
  },
}));

const webhookService = require("../src/services/webhookService");
const paymentMonitor = require("../src/services/paymentMonitor");

// Distinct accounts for registry tests
const ACCOUNT_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const ACCOUNT_B = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";
const ACCOUNT_C = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

// Each stream-lifecycle test gets its own account so the shared in-memory
// store never carries state from a previous test.
const ACCOUNT_LAST  = "GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH2BEWNAN4XQSBFI3T";
const ACCOUNT_MULTI = "GC3QCNXPQK4FQJ3QLZBQBFN7GFNKUXGZ5PHTQTQ27PSGXQP7WV5QLKJ";
const ACCOUNT_MISS  = "GAZJ3QCNXPQK4FQJ3QLZBQBFN7GFNKUXGZ5PHTQTQ27PSGXQP7WV5QK";
const ACCOUNT_CDR   = "GBCUQJHCXPQK4FQJ3QLZBQBFN7GFNKUXGZ5PHTQTQ27PSGXQP7WV5QL";

describe("webhook registry", () => {
  it("registers and lists webhooks for an account", () => {
    const webhook = webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret"
    );

    const list = webhookService.getWebhooksByPublicKey(ACCOUNT_A);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("https://x.test/hook");
    expect(list[0].id).toBe(webhook.id);
  });

  it("scopes listing to the account and supports deletion", () => {
    const webhook = webhookService.registerWebhook(
      ACCOUNT_B,
      "https://x.test/a",
      "secret-aaa"
    );
    webhookService.registerWebhook(ACCOUNT_C, "https://x.test/b", "secret-bbb");

    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_B)).toHaveLength(1);
    expect(webhookService.deleteWebhook(webhook.id)).toBe(true);
    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_B)).toHaveLength(0);
  });
});

describe("stream lifecycle on webhook deletion", () => {
  beforeEach(() => {
    mockClose.mockClear();
  });

  it("closes the Horizon stream when the last webhook for an account is deleted", () => {
    const hook = webhookService.registerWebhook(
      ACCOUNT_LAST,
      "https://d.test/hook",
      "secret-d"
    );

    // One registration remains before deletion
    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_LAST)).toHaveLength(1);

    const deleted = webhookService.deleteWebhook(hook.id);

    expect(deleted).toBe(true);
    // Zero registrations remain after deletion
    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_LAST)).toHaveLength(0);
    // The SSE close function must have been called
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close the stream when other webhooks for the account still exist", () => {
    const hookOne = webhookService.registerWebhook(
      ACCOUNT_MULTI,
      "https://d.test/hook1",
      "secret-d1"
    );
    webhookService.registerWebhook(
      ACCOUNT_MULTI,
      "https://d.test/hook2",
      "secret-d2"
    );

    // Delete only the first webhook — one still remains
    webhookService.deleteWebhook(hookOne.id);

    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_MULTI)).toHaveLength(1);
    // Stream must still be open
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("returns false and does not close the stream when deleting a non-existent id", () => {
    const result = webhookService.deleteWebhook("9999");
    expect(result).toBe(false);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("create → delete → recreate: stream is closed then reopened for the same account", () => {
    // --- create ---
    const hook = webhookService.registerWebhook(
      ACCOUNT_CDR,
      "https://d.test/hook",
      "secret-d"
    );
    // Stream is active; mockClose has not been called yet
    expect(mockClose).not.toHaveBeenCalled();

    // --- delete (last webhook) ---
    webhookService.deleteWebhook(hook.id);
    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_CDR)).toHaveLength(0);
    // Close function should have been invoked once
    expect(mockClose).toHaveBeenCalledTimes(1);

    // --- recreate ---
    const hook2 = webhookService.registerWebhook(
      ACCOUNT_CDR,
      "https://d.test/hook-new",
      "secret-d-new"
    );
    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_CDR)).toHaveLength(1);
    expect(hook2.url).toBe("https://d.test/hook-new");

    // Deleting the newly created webhook must close the stream again
    webhookService.deleteWebhook(hook2.id);
    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_CDR)).toHaveLength(0);
    expect(mockClose).toHaveBeenCalledTimes(2);
  });
});

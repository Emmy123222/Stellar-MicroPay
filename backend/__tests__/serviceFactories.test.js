/**
 * __tests__/serviceFactories.test.js
 * Unit tests for the isolated service factories (issue #762).
 *
 * Each factory creates an independent in-memory store, so tests and app
 * instances no longer need to rely on module-singleton state or global
 * reset helpers.
 */

"use strict";

const {
  createUsernameService,
} = require("../src/services/usernameService");
const { createTipsService } = require("../src/services/tipsService");
const { createWebhookStore } = require("../src/services/webhookStore");

const KEY_A = "G" + "A".repeat(55); // 56 chars
const KEY_B = "G" + "B".repeat(55); // 56 chars

describe("createUsernameService", () => {
  it("keeps state isolated between instances", () => {
    const first = createUsernameService();
    const second = createUsernameService();

    first.registerUsername("alice123", KEY_A);

    expect(first.resolveUsername("alice123")).toEqual({
      username: "alice123",
      publicKey: KEY_A,
    });
    expect(() => second.resolveUsername("alice123")).toThrow(
      "Username not found"
    );
    expect(second.getAllUsernames()).toEqual([]);
  });

  it("accepts an injected store without touching the module singleton", () => {
    const store = new Map();
    const service = createUsernameService(store);

    service.registerUsername("bob", KEY_B);

    expect(store.get("bob")).toBe(KEY_B);
    expect(service.store).toBe(store);
  });
});

describe("createTipsService", () => {
  it("keeps tips and counters isolated between instances", () => {
    const first = createTipsService();
    const second = createTipsService();

    const tip = first.recordTip({
      senderPublicKey: KEY_A,
      creatorPublicKey: KEY_B,
      amount: 100,
    });
    expect(tip.id).toBe(1);

    expect(first.getTipsReceived(KEY_B).total).toBe(1);
    expect(second.getTipsReceived(KEY_B).total).toBe(0);

    const secondTip = second.recordTip({
      senderPublicKey: KEY_A,
      creatorPublicKey: KEY_B,
      amount: 200,
    });
    // Counters are independent per instance, not shared globals.
    expect(secondTip.id).toBe(1);
  });
});

describe("createWebhookStore", () => {
  it("keeps webhooks and counters isolated between instances", () => {
    const first = createWebhookStore();
    const second = createWebhookStore();

    const webhook = first.registerWebhook({
      publicKey: KEY_A,
      url: "https://example.com/hook",
      secret: "s3cret",
    });
    expect(webhook.id).toBe("1");

    expect(first.getWebhooksByPublicKey(KEY_A)).toHaveLength(1);
    expect(second.getWebhooksByPublicKey(KEY_A)).toHaveLength(0);

    const secondWebhook = second.registerWebhook({
      publicKey: KEY_B,
      url: "https://example.org/hook",
      secret: "other",
    });
    expect(secondWebhook.id).toBe("1");
  });
});

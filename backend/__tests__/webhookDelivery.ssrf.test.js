"use strict";

jest.mock("node:dns", () => ({
  promises: { lookup: jest.fn() },
}));

const { promises: dns } = require("node:dns");
const {
  deliverWebhook,
  isBlockedAddress,
  validateWebhookUrl,
} = require("../src/services/webhookDelivery");

describe("webhook SSRF protection", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    dns.lookup.mockClear();
    dns.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it.each([
    ["10.0.0.4", "private IPv4"],
    ["172.20.0.4", "private IPv4"],
    ["192.168.1.10", "private IPv4"],
    ["127.0.0.1", "loopback IPv4"],
    ["169.254.169.254", "link-local IPv4"],
    ["::1", "loopback IPv6"],
    ["fc00::1", "private IPv6"],
    ["::ffff:127.0.0.1", "mapped loopback IPv4"],
  ])("blocks %s (%s)", (address) => {
    expect(isBlockedAddress(address)).toBeTruthy();
  });

  it("rejects a hostname resolving to a private address", async () => {
    dns.lookup.mockResolvedValue([{ address: "192.168.1.12", family: 4 }]);

    await expect(validateWebhookUrl("https://internal.example/hook")).rejects.toThrow(
      "blocked private address"
    );
  });

  it("revalidates redirects and refuses a private redirect target", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 307,
      headers: { get: () => "https://internal.example/hook" },
    });
    dns.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);

    await deliverWebhook(
      { id: "wh-1", secret: "secret", url: "https://public.example/hook" },
      { event: "payment_received" }
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(dns.lookup).toHaveBeenCalledTimes(2);
  });

  it("does not make a request for an HTTP or non-default-port URL", async () => {
    await deliverWebhook(
      { id: "wh-2", secret: "secret", url: "http://127.0.0.1:8080/hook" },
      { event: "payment_received" }
    );

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

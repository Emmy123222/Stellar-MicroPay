"use strict";

const webhooks = require("../src/services/webhookService");

const PUBLIC_KEY = `G${"A".repeat(55)}`;

describe("webhook URL SSRF protection", () => {
  it("allows public HTTP(S) URLs", () => {
    expect(webhooks.sanitizeWebhookUrl("https://example.com/hook")).toBe("https://example.com/hook");
  });

  it.each([
    "http://localhost/hook",
    "http://127.0.0.1/hook",
    "http://10.0.0.5/hook",
    "http://172.16.0.1/hook",
    "http://192.168.1.10/hook",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/hook",
    "http://metadata.google.internal/computeMetadata/v1/",
    "file:///etc/passwd",
  ])("rejects %s", (url) => {
    expect(() => webhooks.sanitizeWebhookUrl(url)).toThrow();
  });

  it("rejects registering a webhook that targets a private address", () => {
    expect(() =>
      webhooks.register({ url: "http://169.254.169.254/", publicKey: PUBLIC_KEY, secret: "s" })
    ).toThrow();
  });
});

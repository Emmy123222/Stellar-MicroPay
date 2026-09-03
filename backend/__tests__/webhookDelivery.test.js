/**
 * Webhook delivery resource-bounding tests.
 *
 * These tests prove the four DoS/resource-exhaustion boundaries added to
 * backend/src/services/webhookDelivery.js:
 *   - connect timeout   -> abort classified as "connect_timeout"
 *   - total timeout     -> abort classified as "total_timeout"
 *   - max redirects     -> abort classified as "too_many_redirects"
 *   - max response size -> abort classified as "response_too_large"
 *
 * Each over-limit case verifies the delivery is aborted cleanly (never hangs),
 * the returned outcome records the error code, and `overLimit` is true.
 */
"use strict";

const http = require("http");

const {
  deliverWebhook,
  requestOnce,
  WebhookResourceLimitError,
  DEFAULT_LIMITS,
  resolveLimits,
} = require("../src/services/webhookDelivery");

const WEBHOOK = {
  id: "wh-test-1",
  publicKey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
  url: "http://127.0.0.1:0/pending",
  secret: "super-secret",
  createdAt: new Date().toISOString(),
};

const PAYLOAD = {
  event: "payment_received",
  publicKey: WEBHOOK.publicKey,
  amount: "1.0000000",
  asset: "native",
  from: "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX",
  transactionHash: "abc123",
  ledger: 1234,
  timestamp: "2026-01-01T00:00:00.000Z",
};

/**
 * Spin up a throwaway HTTP server on 127.0.0.1.
 * Tracks connections so `close()` can force-destroy open sockets (needed for
 * the timeout tests where the server intentionally never responds).
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.on("error", () => {});
      req.on("error", () => {});
      handler(req, res);
    });
    const sockets = new Set();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("clientError", () => {});
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((closeResolve) => {
            for (const socket of sockets) socket.destroy();
            server.close(closeResolve);
          }),
      });
    });
  });
}

function deliveryLimits(overrides = {}) {
  return {
    // Aggressively small so tests complete fast and prove the boundaries.
    connectTimeoutMs: 200,
    totalTimeoutMs: 200,
    maxRedirects: 5,
    maxResponseBytes: 1024,
    ...overrides,
  };
}

describe("webhook delivery resource bounds", () => {
  describe("basic delivery", () => {
    it("posts the signed payload and returns a success outcome", async () => {
      const server = await startServer((req, res) => {
        expect(req.method).toBe("POST");
        expect(req.headers["content-type"]).toContain("application/json");
        expect(req.headers["x-webhook-id"]).toBe(WEBHOOK.id);
        expect(req.headers["x-stellar-signature"]).toMatch(/^sha256=/);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      });

      try {
        const outcome = await deliverWebhook(
          { ...WEBHOOK, url: server.url },
          PAYLOAD,
          { limits: deliveryLimits({ totalTimeoutMs: 2000 }) }
        );
        expect(outcome).toEqual({ ok: true, status: 200, error: null });
      } finally {
        await server.close();
      }
    });

    it("records a non-2xx response without throwing", async () => {
      const server = await startServer((req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end('{"error":"boom"}');
      });

      try {
        const outcome = await deliverWebhook(
          { ...WEBHOOK, url: server.url },
          PAYLOAD,
          { limits: deliveryLimits() }
        );
        expect(outcome.ok).toBe(false);
        expect(outcome.status).toBe(500);
        expect(outcome.error.code).toBe("http_error");
        expect(outcome.error.overLimit).toBeFalsy();
      } finally {
        await server.close();
      }
    });

    it("records a network error (no over-limit flag) when the port is closed", async () => {
      const server = await startServer(() => {});
      const deadUrl = server.url;
      await server.close();

      const outcome = await deliverWebhook(
        { ...WEBHOOK, url: deadUrl },
        PAYLOAD,
        { limits: deliveryLimits() }
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.status).toBeNull();
      expect(outcome.error.overLimit).toBe(false);
    });
  });

  describe("connect timeout", () => {
    it("aborts a delivery whose first headers never arrive and classifies it as connect_timeout", async () => {
      // Server accepts the TCP connection but never writes an HTTP response.
      const server = await startServer(() => {});

      try {
        const outcome = await deliverWebhook(
          { ...WEBHOOK, url: server.url },
          PAYLOAD,
          { limits: deliveryLimits({ connectTimeoutMs: 100, totalTimeoutMs: 5000 }) }
        );
        expect(outcome.ok).toBe(false);
        expect(outcome.error.code).toBe("connect_timeout");
        expect(outcome.error.overLimit).toBe(true);
      } finally {
        await server.close();
      }
    });
  });

  describe("total timeout", () => {
    it("aborts a delivery that exceeds the total deadline and classifies it as total_timeout", async () => {
      // Headers arrive quickly; the body then streams forever (never ends).
      const server = await startServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"streaming":');
        // Intentionally leave the response body open.
      });

      try {
        const outcome = await deliverWebhook(
          { ...WEBHOOK, url: server.url },
          PAYLOAD,
          { limits: deliveryLimits({ connectTimeoutMs: 5000, totalTimeoutMs: 100 }) }
        );
        expect(outcome.ok).toBe(false);
        expect(outcome.error.code).toBe("total_timeout");
        expect(outcome.error.overLimit).toBe(true);
      } finally {
        await server.close();
      }
    });
  });

  describe("redirect boundaries", () => {
    it("follows redirects up to the limit and succeeds", async () => {
      const server = await startServer((req, res) => {
        switch (req.url) {
          case "/start":
            res.writeHead(302, { Location: "/mid" });
            return res.end();
          case "/mid":
            res.writeHead(302, { Location: "/final" });
            return res.end();
          default:
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end("{}");
        }
      });

      try {
        const outcome = await deliverWebhook(
          { ...WEBHOOK, url: server.url + "/start" },
          PAYLOAD,
          { limits: deliveryLimits() }
        );
        expect(outcome).toEqual({ ok: true, status: 200, error: null });
      } finally {
        await server.close();
      }
    });

    it("aborts an unbounded redirect loop and classifies it as too_many_redirects", async () => {
      const server = await startServer((req, res) => {
        res.writeHead(302, { Location: "/loop" });
        res.end();
      });

      try {
        const outcome = await deliverWebhook(
          { ...WEBHOOK, url: server.url + "/loop" },
          PAYLOAD,
          { limits: deliveryLimits({ maxRedirects: 2, totalTimeoutMs: 5000 }) }
        );
        expect(outcome.ok).toBe(false);
        expect(outcome.error.code).toBe("too_many_redirects");
        expect(outcome.error.overLimit).toBe(true);
      } finally {
        await server.close();
      }
    });
  });

  describe("response size boundary", () => {
    it("aborts an oversized response and classifies it as response_too_large", async () => {
      const server = await startServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        // Exceeds the 1 KiB cap in a single chunk.
        res.write("x".repeat(4096));
        res.end();
      });

      try {
        const outcome = await deliverWebhook(
          { ...WEBHOOK, url: server.url },
          PAYLOAD,
          { limits: deliveryLimits({ maxResponseBytes: 1024, totalTimeoutMs: 5000 }) }
        );
        expect(outcome.ok).toBe(false);
        expect(outcome.error.code).toBe("response_too_large");
        expect(outcome.error.overLimit).toBe(true);
      } finally {
        await server.close();
      }
    });
  });

  describe("requests are bounded and can never hang", () => {
    it("completes quickly even when the peer refuses to respond (regression guard)", async () => {
      const server = await startServer(() => {}); // never responds

      try {
        const started = Date.now();
        const outcome = await deliverWebhook(
          { ...WEBHOOK, url: server.url },
          PAYLOAD,
          { limits: deliveryLimits({ connectTimeoutMs: 100, totalTimeoutMs: 5000 }) }
        );
        const elapsed = Date.now() - started;
        expect(outcome.error.overLimit).toBe(true);
        expect(elapsed).toBeLessThan(2000); // ~100ms timer, far under 2s
      } finally {
        await server.close();
      }
    });
  });
});

describe("webhook delivery exports", () => {
  it("exposes immutable default limits", () => {
    expect(DEFAULT_LIMITS.connectTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.totalTimeoutMs).toBeGreaterThan(DEFAULT_LIMITS.connectTimeoutMs);
    expect(DEFAULT_LIMITS.maxRedirects).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.maxResponseBytes).toBeGreaterThan(0);
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
  });

  it("resolveLimits merges overrides over defaults without mutating them", () => {
    const resolved = resolveLimits({ maxRedirects: 1, totalTimeoutMs: 42 });
    expect(resolved.maxRedirects).toBe(1);
    expect(resolved.totalTimeoutMs).toBe(42);
    expect(resolved.connectTimeoutMs).toBe(DEFAULT_LIMITS.connectTimeoutMs);
    expect(resolved.maxResponseBytes).toBe(DEFAULT_LIMITS.maxResponseBytes);
  });

  it("WebhookResourceLimitError carries an over-limit classification", () => {
    const err = new WebhookResourceLimitError("boom", "too_many_redirects", 5);
    expect(err).toBeInstanceOf(Error);
    expect(err.overLimit).toBe(true);
    expect(err.code).toBe("too_many_redirects");
    expect(err.limit).toBe(5);
  });

  it("requestOnce rejects with a response_too_large limit error (unit-level guard)", async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write(JSON.stringify({ data: "z".repeat(4096) }));
      res.end();
    });

    try {
      const limits = resolveLimits({ maxResponseBytes: 512, totalTimeoutMs: 5000 });
      await expect(
        requestOnce(server.url + "/big", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          limits,
          signal: undefined,
        })
      ).rejects.toMatchObject({ code: "response_too_large", overLimit: true });
    } finally {
      await server.close();
    }
  });
});
/**
 * __tests__/analyticsController.test.js
 * Regression tests for SSE connection limits and backpressure (#841).
 *
 * Covers:
 *  - per-account and per-IP active connection limits → 429 Too Many Requests
 *  - slot release/cleanup on disconnect (close/abort/end/socket error)
 *  - backpressure-aware writes (buffering while res.write() = false, flush on
 *    'drain', and termination of permanently-stalled consumers)
 *  - heartbeat keep-alive and stale-connection termination
 */

"use strict";

const express = require("express");
const request = require("supertest");
const {
  SseConnectionRegistry,
  sseConnectionLimiter,
  releaseConnection,
  createSseWriter,
  heartbeatPing,
} = require("../src/middleware/sseGuard");

const PUBLIC_KEY = "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW";
const OTHER_KEY = "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYGJ2DN5ZKQYTROZXNUAAOXWS7";

describe("SSE connection registry", () => {
  let registry;

  beforeEach(() => {
    registry = new SseConnectionRegistry({ maxPerAccount: 2, maxPerIp: 3 });
  });

  it("allows connections up to the per-account and per-IP limits", () => {
    expect(registry.acquire(PUBLIC_KEY, "10.0.0.1").token).toBeDefined();
    expect(registry.acquire(PUBLIC_KEY, "10.0.0.1").token).toBeDefined();
    expect(registry.accountCount(PUBLIC_KEY)).toBe(2);
    expect(registry.ipCount("10.0.0.1")).toBe(2);
  });

  it("returns a reason string when the per-account limit is exceeded", () => {
    registry.acquire(PUBLIC_KEY, "10.0.0.1");
    registry.acquire(PUBLIC_KEY, "10.0.0.2");

    const result = registry.acquire(PUBLIC_KEY, "10.0.0.3");
    expect(result.reason).toMatch(/Too many active SSE connections for this account/i);
    expect(registry.accountCount(PUBLIC_KEY)).toBe(2);
  });

  it("returns a reason string when the per-IP limit is exceeded", () => {
    registry.acquire(PUBLIC_KEY, "10.0.0.1");
    registry.acquire(OTHER_KEY, "10.0.0.1");
    registry.acquire("GBREFU", "10.0.0.1");

    const result = registry.acquire("GBRXYZ", "10.0.0.1");
    expect(result.reason).toMatch(/Too many active SSE connections from this IP/i);
    expect(registry.ipCount("10.0.0.1")).toBe(3);
  });

  it("frees a slot after release so a new connection is accepted", () => {
    const tokenA = registry.acquire(PUBLIC_KEY, "10.0.0.1").token;
    const tokenB = registry.acquire(PUBLIC_KEY, "10.0.0.2").token;

    expect(registry.acquire(PUBLIC_KEY, "10.0.0.3").reason).toBeDefined();

    registry.release(PUBLIC_KEY, "10.0.0.1", tokenA);
    registry.release(PUBLIC_KEY, "10.0.0.2", tokenB);
    expect(registry.accountCount(PUBLIC_KEY)).toBe(0);
    expect(registry.acquire(PUBLIC_KEY, "10.0.0.3").token).toBeDefined();
  });

  it("release is safe to call multiple times and with unknown tokens", () => {
    registry.acquire(PUBLIC_KEY, "10.0.0.1");
    registry.release(PUBLIC_KEY, "10.0.0.1", Symbol("unknown"));
    registry.release(PUBLIC_KEY, "10.0.0.1", undefined);
    expect(registry.accountCount(PUBLIC_KEY)).toBe(1);
  });
});

describe("sseConnectionLimiter middleware", () => {
  let registry;

  function buildApp() {
    const app = express();
    app.set("trust proxy", 1);
    // Deliberately do NOT release slots here: we want the acquired slots to
    // remain "held" across sequential requests so the limit tests are
    // deterministic (no races with async socket-close handlers).
    const capture = (req, res) => {
      res.status(200).json({ streaming: true });
    };
    app.get(
      "/:publicKey/stream",
      sseConnectionLimiter({ registry }),
      capture
    );
    return app;
  }

  beforeEach(() => {
    registry = new SseConnectionRegistry({ maxPerAccount: 1, maxPerIp: 2 });
  });

  it("passes through when within limits", async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/${PUBLIC_KEY}/stream`)
      .set("X-Forwarded-For", "10.1.0.1");
    expect(res.status).toBe(200);
  });

  it("returns 429 when the per-account limit is exceeded", async () => {
    const app = buildApp();
    // First connection occupies the account slot.
    await request(app).get(`/${PUBLIC_KEY}/stream`).set("X-Forwarded-For", "10.1.0.1");

    const res = await request(app)
      .get(`/${PUBLIC_KEY}/stream`)
      .set("X-Forwarded-For", "10.1.0.2");
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Too many active SSE connections for this account/i);
  });

  it("returns 429 when the per-IP limit is exceeded", async () => {
    const app = buildApp();
    // maxPerIp = 2; the first two requests from one IP are admitted, the third
    // (distinct account) exceeds the IP limit.
    const first = await request(app)
      .get(`/${PUBLIC_KEY}/stream`)
      .set("X-Forwarded-For", "10.2.0.1");
    const second = await request(app)
      .get(`/${OTHER_KEY}/stream`)
      .set("X-Forwarded-For", "10.2.0.1");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const res = await request(app)
      .get(`/GBREFU/stream`)
      .set("X-Forwarded-For", "10.2.0.1");
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Too many active SSE connections from this IP/i);
  });

  it("releases the slot on disconnect so new connections are accepted again", async () => {
    const innerApp = express();
    innerApp.set("trust proxy", 1);
    let captured;
    innerApp.get(
      "/:publicKey/stream",
      sseConnectionLimiter({ registry }),
      (req, res) => {
        captured = res;
        res.status(200).json({ streaming: true });
      }
    );

    const first = await request(innerApp)
      .get(`/${PUBLIC_KEY}/stream`)
      .set("X-Forwarded-For", "10.3.0.1");
    expect(first.status).toBe(200);
    expect(registry.accountCount(PUBLIC_KEY)).toBe(1);
    expect(registry.ipCount("10.3.0.1")).toBe(1);

    // The controller's cleanup path would call releaseConnection on close.
    releaseConnection(captured);
    expect(registry.accountCount(PUBLIC_KEY)).toBe(0);
    expect(registry.ipCount("10.3.0.1")).toBe(0);

    // A new connection is now admitted.
    const second = await request(innerApp)
      .get(`/${PUBLIC_KEY}/stream`)
      .set("X-Forwarded-For", "10.3.0.1");
    expect(second.status).toBe(200);
  });
});

describe("createSseWriter (backpressure)", () => {
  it("buffers frames while paused and flushes on drain", () => {
    const writes = [];
    const listeners = {};
    const res = {
      write: (chunk) => {
        writes.push(chunk);
        return false; // simulate a full socket → backpressure
      },
      end: () => {
        writes.push("__END__");
      },
      writableEnded: false,
      on: (evt, cb) => {
        listeners[evt] = cb;
      },
      destroy: () => {},
    };

    const writer = createSseWriter(res);
    // The first write reaches the full socket and reports backpressure.
    expect(writer.write("a")).toBe(false);
    // Subsequent frames are buffered, not pushed to the socket.
    expect(writer.write("b")).toBe(true);
    expect(writer.write("c")).toBe(true);
    expect(writes).toEqual(["a"]);

    // Flush the buffer as the socket drains.
    res.write = (chunk) => {
      writes.push(chunk);
      return true;
    };
    listeners["drain"]();
    expect(writer.paused()).toBe(false);
    expect(writes).toEqual(["a", "b", "c"]);
  });

  it("terminates a permanently stalled consumer when the buffer overflows", () => {
    let destroyed = false;
    const listeners = {};
    const res = {
      write: () => false,
      end: () => {},
      writableEnded: false,
      on: (evt, cb) => {
        listeners[evt] = cb;
      },
      destroy: () => {
        destroyed = true;
      },
    };

    const writer = createSseWriter(res, { maxBuffer: 2 });
    writer.write("1"); // direct → paused
    writer.write("2"); // buffered (1)
    writer.write("3"); // buffered (2)
    expect(destroyed).toBe(false);
    // Buffer full (2) and still stalled → the next write overflows.
    writer.write("4");
    expect(destroyed).toBe(true);
  });

  it("end() finalizes the response", () => {
    const listeners = {};
    let ended = false;
    const res = {
      write: () => true,
      end: () => {
        ended = true;
      },
      writableEnded: false,
      on: () => {},
      destroy: () => {},
    };
    const writer = createSseWriter(res);
    writer.end();
    expect(ended).toBe(true);
  });
});

describe("heartbeatPing", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("writes heartbeat frames and stops on the returned stop function", () => {
    const listeners = {};
    const res = {
      write: () => true,
      end: () => {},
      writableEnded: false,
      destroy: () => {},
      on: (evt, cb) => {
        listeners[evt] = cb;
      },
    };
    const writer = { write: jest.fn(() => true) };

    const stop = heartbeatPing(res, writer, { heartbeatMs: 1000, staleTimeoutMs: 5000 });
    jest.advanceTimersByTime(2500);
    expect(writer.write).toHaveBeenCalledWith(": heartbeat\n\n");
    expect(writer.write).toHaveBeenCalledTimes(2);

    stop();
    jest.advanceTimersByTime(5000);
    const calls = writer.write.mock.calls.length;
    jest.advanceTimersByTime(5000);
    expect(writer.write.mock.calls.length).toBe(calls);
  });

  it("destroys the socket when the consumer stays stalled past the stale timeout", () => {
    let destroyed = null;
    const listeners = {};
    const res = {
      write: () => false,
      end: () => {},
      writableEnded: false,
      destroy: () => {
        destroyed = true;
      },
      on: (evt, cb) => {
        listeners[evt] = cb;
      },
    };
    const writer = { write: jest.fn(() => false) };

    heartbeatPing(res, writer, { heartbeatMs: 1000, staleTimeoutMs: 5000 });
    // At 5000ms `Date.now() - lastDrain` equals the stale timeout (not > it);
    // the 6000ms tick is the first one that exceeds it.
    jest.advanceTimersByTime(6100);
    expect(destroyed).toBe(true);
  });
});

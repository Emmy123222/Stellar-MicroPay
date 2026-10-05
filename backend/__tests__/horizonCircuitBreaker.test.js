/**
 * __tests__/horizonCircuitBreaker.test.js
 * Unit tests for the Horizon API circuit breaker (Issue #1203).
 *
 * Tests cover:
 *   - CLOSED state: requests pass through and successes clear failure count
 *   - OPEN state: circuit opens after threshold failures, 503 middleware response
 *   - HALF_OPEN state: a probe is allowed, failure re-opens, success closes
 */

"use strict";

const {
  withCircuitBreaker,
  horizonCircuitBreakerMiddleware,
  getCircuitStatus,
  resetCircuit,
  recordFailure,
  recordSuccess,
  STATE,
  _setConfigForTesting,
  _forceStateForTesting,
} = require("../src/middleware/horizonCircuitBreaker");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock Horizon 5xx error shaped like Axios/Horizon SDK. */
function makeHorizonError(status = 500) {
  const err = new Error(`Horizon ${status}`);
  err.response = { status };
  return err;
}

/** Create a mock Express response object. */
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetCircuit();
  // Speed up tests: 3-failure threshold, 5-second window, 1-second probe
  _setConfigForTesting({ failureThreshold: 3, windowMs: 5000, probeIntervalMs: 1000 });
});

afterEach(() => {
  resetCircuit();
  jest.useRealTimers();
});

// ─── CLOSED state ─────────────────────────────────────────────────────────────

describe("CLOSED state", () => {
  it("passes through a successful Horizon call", async () => {
    const fn = jest.fn().mockResolvedValue("account-data");
    const result = await withCircuitBreaker(fn);
    expect(result).toBe("account-data");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-5xx error without recording a failure", async () => {
    const err = new Error("400 bad request");
    err.response = { status: 400 };
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withCircuitBreaker(fn)).rejects.toThrow("400 bad request");
    expect(getCircuitStatus().failures).toBe(0);
    expect(getCircuitStatus().state).toBe(STATE.CLOSED);
  });

  it("records a failure for Horizon 5xx errors", async () => {
    const fn = jest.fn().mockRejectedValue(makeHorizonError(503));
    await expect(withCircuitBreaker(fn)).rejects.toThrow();
    expect(getCircuitStatus().failures).toBe(1);
    expect(getCircuitStatus().state).toBe(STATE.CLOSED);
  });

  it("opens the circuit after reaching the failure threshold", async () => {
    const fn = jest.fn().mockRejectedValue(makeHorizonError(500));

    for (let i = 0; i < 3; i++) {
      await expect(withCircuitBreaker(fn)).rejects.toThrow();
    }

    expect(getCircuitStatus().state).toBe(STATE.OPEN);
  });

  it("allows middleware to call next() in CLOSED state", () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    horizonCircuitBreakerMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── OPEN state ───────────────────────────────────────────────────────────────

describe("OPEN state", () => {
  beforeEach(() => {
    _forceStateForTesting(STATE.OPEN);
  });

  it("short-circuits withCircuitBreaker with a 503 error", async () => {
    const fn = jest.fn();
    const err = await withCircuitBreaker(fn).catch((e) => e);

    expect(fn).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/temporarily unavailable/i);
  });

  it("middleware returns 503 JSON when circuit is OPEN", () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    horizonCircuitBreakerMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/temporarily unavailable/i) })
    );
  });

  it("exposes lastOpenedAt timestamp once the circuit opens", async () => {
    // Close first, re-open via threshold
    resetCircuit();
    _setConfigForTesting({ failureThreshold: 2, windowMs: 5000, probeIntervalMs: 1000 });
    const fn = jest.fn().mockRejectedValue(makeHorizonError(500));
    await expect(withCircuitBreaker(fn)).rejects.toThrow();
    await expect(withCircuitBreaker(fn)).rejects.toThrow();

    const { lastOpenedAt, state } = getCircuitStatus();
    expect(state).toBe(STATE.OPEN);
    expect(lastOpenedAt).toBeGreaterThan(0);
  });
});

// ─── HALF_OPEN state ──────────────────────────────────────────────────────────

describe("HALF_OPEN state", () => {
  beforeEach(() => {
    _forceStateForTesting(STATE.HALF_OPEN);
  });

  it("allows exactly one probe request through in HALF_OPEN state", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await withCircuitBreaker(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("closes the circuit when the probe succeeds", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await withCircuitBreaker(fn);
    expect(getCircuitStatus().state).toBe(STATE.CLOSED);
  });

  it("re-opens the circuit when the probe fails with a 5xx", async () => {
    const fn = jest.fn().mockRejectedValue(makeHorizonError(502));
    await expect(withCircuitBreaker(fn)).rejects.toThrow();
    expect(getCircuitStatus().state).toBe(STATE.OPEN);
  });

  it("middleware lets the probe through in HALF_OPEN state", () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    horizonCircuitBreakerMiddleware(req, res, next);

    // HALF_OPEN is not OPEN, so middleware should call next
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── recordFailure / recordSuccess ────────────────────────────────────────────

describe("recordFailure and recordSuccess", () => {
  it("recordSuccess in HALF_OPEN closes the circuit", () => {
    _forceStateForTesting(STATE.HALF_OPEN);
    recordSuccess();
    expect(getCircuitStatus().state).toBe(STATE.CLOSED);
  });

  it("recordSuccess in CLOSED state is a no-op", () => {
    recordSuccess();
    expect(getCircuitStatus().state).toBe(STATE.CLOSED);
  });

  it("recordFailure in HALF_OPEN re-opens the circuit", () => {
    _forceStateForTesting(STATE.HALF_OPEN);
    recordFailure();
    expect(getCircuitStatus().state).toBe(STATE.OPEN);
  });

  it("failures outside the time window do not count toward the threshold", () => {
    jest.useFakeTimers();
    _setConfigForTesting({ failureThreshold: 3, windowMs: 1000, probeIntervalMs: 30000 });

    // Record 2 failures...
    recordFailure();
    recordFailure();

    // ...then advance past the window
    jest.advanceTimersByTime(1500);

    // 3rd failure should NOT open because the first two are now stale
    recordFailure();

    expect(getCircuitStatus().state).toBe(STATE.CLOSED);
  });
});

// ─── getCircuitStatus ─────────────────────────────────────────────────────────

describe("getCircuitStatus", () => {
  it("returns CLOSED with 0 failures on fresh init", () => {
    const status = getCircuitStatus();
    expect(status.state).toBe(STATE.CLOSED);
    expect(status.failures).toBe(0);
    expect(status.lastOpenedAt).toBeNull();
  });

  it("reflects accumulated failures correctly", async () => {
    const fn = jest.fn().mockRejectedValue(makeHorizonError(500));
    await expect(withCircuitBreaker(fn)).rejects.toThrow();
    await expect(withCircuitBreaker(fn)).rejects.toThrow();
    expect(getCircuitStatus().failures).toBe(2);
  });
});

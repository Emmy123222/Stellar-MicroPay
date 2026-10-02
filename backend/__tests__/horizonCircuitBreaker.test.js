/**
 * __tests__/horizonCircuitBreaker.test.js
 * Unit tests for the Horizon circuit breaker.
 */

"use strict";

const breaker = require("../src/services/horizonCircuitBreaker");

/** Builds an error shaped like a Horizon network failure. */
function networkError() {
  const err = new Error("connection refused");
  err.response = { status: 503 };
  return err;
}

/** Builds an error shaped like a Horizon 404. */
function notFoundError() {
  const err = new Error("not found");
  err.response = { status: 404 };
  return err;
}

describe("horizonCircuitBreaker", () => {
  beforeEach(() => {
    breaker.reset();
  });

  afterAll(() => {
    breaker.reset();
  });

  it("starts closed", () => {
    expect(breaker.getState()).toEqual({ state: "closed", consecutiveFailures: 0 });
  });

  it("passes a successful call through and returns its result", async () => {
    const result = await breaker.exec(async () => "ok");

    expect(result).toBe("ok");
    expect(breaker.getState().state).toBe("closed");
  });

  it("counts consecutive failures", async () => {
    await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();
    await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();

    expect(breaker.getState().consecutiveFailures).toBe(2);
    expect(breaker.getState().state).toBe("closed");
  });

  it("opens once the failure threshold is reached", async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();
    }

    expect(breaker.getState().state).toBe("open");
  });

  it("rejects with a 503 while open", async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();
    }

    await expect(breaker.exec(async () => "should not run")).rejects.toMatchObject({
      status: 503,
    });
  });

  it("does not invoke the wrapped function while open", async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();
    }

    const guarded = jest.fn(async () => "ok");
    await expect(breaker.exec(guarded)).rejects.toMatchObject({ status: 503 });

    expect(guarded).not.toHaveBeenCalled();
  });

  it("resets the failure count after a success", async () => {
    await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();
    await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();
    await breaker.exec(async () => "ok");

    expect(breaker.getState().consecutiveFailures).toBe(0);
  });

  it("does not count a 404 as a failure", async () => {
    for (let i = 0; i < 10; i += 1) {
      await expect(
        breaker.exec(async () => { throw notFoundError(); }, { isFailure: (e) => e.response.status !== 404 })
      ).rejects.toThrow();
    }

    expect(breaker.getState().state).toBe("closed");
    expect(breaker.getState().consecutiveFailures).toBe(0);
  });

  it("treats a non-failure outcome as evidence the circuit is healthy", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    for (let i = 0; i < 5; i += 1) {
      await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();
    }
    expect(breaker.getState().state).toBe("open");

    // Past the reset timeout the circuit is half-open and admits one probe.
    // A 404 means Horizon answered, so the circuit must close.
    jest.setSystemTime(new Date("2026-01-01T00:00:31Z"));
    await expect(
      breaker.exec(async () => { throw notFoundError(); }, { isFailure: (e) => e.response.status !== 404 })
    ).rejects.toThrow();

    expect(breaker.getState().state).toBe("closed");
    expect(breaker.getState().consecutiveFailures).toBe(0);

    jest.useRealTimers();
  });

  describe("half-open", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    async function tripBreaker() {
      for (let i = 0; i < 5; i += 1) {
        await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();
      }
      expect(breaker.getState().state).toBe("open");
    }

    it("stays open before the reset timeout elapses", async () => {
      await tripBreaker();

      jest.setSystemTime(new Date("2026-01-01T00:00:29Z"));
      await expect(breaker.exec(async () => "ok")).rejects.toMatchObject({ status: 503 });
    });

    it("moves to half-open after the reset timeout", async () => {
      await tripBreaker();

      jest.setSystemTime(new Date("2026-01-01T00:00:31Z"));
      const guarded = jest.fn(async () => "recovered");

      await expect(breaker.exec(guarded)).resolves.toBe("recovered");
      expect(guarded).toHaveBeenCalledTimes(1);
      expect(breaker.getState().state).toBe("closed");
    });

    it("closes the circuit when the probe succeeds", async () => {
      await tripBreaker();
      jest.setSystemTime(new Date("2026-01-01T00:00:31Z"));

      await breaker.exec(async () => "recovered");

      expect(breaker.getState()).toEqual({ state: "closed", consecutiveFailures: 0 });
    });

    it("re-opens the circuit when the probe fails", async () => {
      await tripBreaker();
      jest.setSystemTime(new Date("2026-01-01T00:00:31Z"));

      await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();

      expect(breaker.getState().state).toBe("open");
    });

    it("admits only a single concurrent probe", async () => {
      await tripBreaker();
      jest.setSystemTime(new Date("2026-01-01T00:00:31Z"));

      let releaseProbe;
      const probe = breaker.exec(
        () => new Promise((resolve) => { releaseProbe = resolve; })
      );

      await expect(breaker.exec(async () => "second")).rejects.toMatchObject({ status: 503 });

      releaseProbe("first");
      await expect(probe).resolves.toBe("first");
    });
  });

  describe("reset()", () => {
    it("returns the breaker to a closed state", async () => {
      for (let i = 0; i < 5; i += 1) {
        await expect(breaker.exec(async () => { throw networkError(); })).rejects.toThrow();
      }
      expect(breaker.getState().state).toBe("open");

      breaker.reset();

      expect(breaker.getState()).toEqual({ state: "closed", consecutiveFailures: 0 });
      await expect(breaker.exec(async () => "ok")).resolves.toBe("ok");
    });
  });
});

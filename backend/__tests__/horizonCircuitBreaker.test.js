/**
 * __tests__/horizonCircuitBreaker.test.js (#840)
 */

"use strict";

const {
  STATES,
  HorizonCircuitOpenError,
  inferNetworkFromHorizonUrl,
  getBreaker,
  getAllBreakerStates,
  resetAllBreakers,
} = require("../src/services/horizonCircuitBreaker");

const TESTNET_URL = "https://horizon-testnet.stellar.org";
const MAINNET_URL = "https://horizon.stellar.org";

describe("horizonCircuitBreaker (#840)", () => {
  beforeEach(() => {
    resetAllBreakers();
    delete process.env.STELLAR_NETWORK;
  });

  afterAll(() => {
    resetAllBreakers();
  });

  describe("inferNetworkFromHorizonUrl", () => {
    it("detects testnet from Horizon URL", () => {
      expect(inferNetworkFromHorizonUrl(TESTNET_URL)).toBe("testnet");
    });

    it("detects mainnet from Horizon URL", () => {
      expect(inferNetworkFromHorizonUrl(MAINNET_URL)).toBe("mainnet");
    });

    it("prefers explicit STELLAR_NETWORK over URL heuristics", () => {
      process.env.STELLAR_NETWORK = "mainnet";
      expect(inferNetworkFromHorizonUrl(TESTNET_URL)).toBe("mainnet");
    });
  });

  it("opens after bounded consecutive failures per origin", () => {
    const breaker = getBreaker(TESTNET_URL, { failureThreshold: 3 });

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe(STATES.CLOSED);

    breaker.recordFailure();
    expect(breaker.state).toBe(STATES.OPEN);
    expect(breaker.snapshot().retryAfterMs).toBeGreaterThan(0);
  });

  it("exposes open and half-open status with retry guidance", () => {
    const breaker = getBreaker(TESTNET_URL, {
      failureThreshold: 1,
      openDurationMs: 1_000,
      halfOpenMaxProbes: 1,
    });

    breaker.recordFailure();
    expect(breaker.snapshot()).toMatchObject({
      origin: "https://horizon-testnet.stellar.org",
      network: "testnet",
      state: STATES.OPEN,
    });

    breaker.openedAt = Date.now() - 2_000;
    breaker.refreshState();
    expect(breaker.state).toBe(STATES.HALF_OPEN);

    expect(getAllBreakerStates()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: STATES.HALF_OPEN, network: "testnet" }),
      ])
    );
  });

  it("throws HorizonCircuitOpenError with retry metadata when open", () => {
    const breaker = getBreaker(TESTNET_URL, { failureThreshold: 1 });
    breaker.recordFailure();

    expect(() => breaker.assertCanExecute()).toThrow(HorizonCircuitOpenError);
    try {
      breaker.assertCanExecute();
    } catch (err) {
      expect(err.status).toBe(503);
      expect(err.code).toBe("HORIZON_CIRCUIT_OPEN");
      expect(err.retryAfterMs).toBeGreaterThanOrEqual(0);
      expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(err.network).toBe("testnet");
      expect(err.state).toBe(STATES.OPEN);
    }
  });

  it("closes again after a successful half-open probe", () => {
    const breaker = getBreaker(TESTNET_URL, {
      failureThreshold: 1,
      openDurationMs: 0,
      halfOpenMaxProbes: 1,
    });

    breaker.recordFailure();
    breaker.refreshState();
    expect(breaker.state).toBe(STATES.HALF_OPEN);

    breaker.assertCanExecute();
    breaker.recordSuccess();
    expect(breaker.state).toBe(STATES.CLOSED);
  });

  it("tracks separate breaker state per Horizon origin", () => {
    const testnetBreaker = getBreaker(TESTNET_URL, { failureThreshold: 1 });
    const mainnetBreaker = getBreaker(MAINNET_URL, { failureThreshold: 1 });

    testnetBreaker.recordFailure();

    expect(testnetBreaker.state).toBe(STATES.OPEN);
    expect(mainnetBreaker.state).toBe(STATES.CLOSED);
    expect(getAllBreakerStates()).toHaveLength(2);
  });
});

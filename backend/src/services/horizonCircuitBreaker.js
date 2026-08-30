/**
 * src/services/horizonCircuitBreaker.js
 * Bounded circuit breaker per Horizon origin to prevent retry amplification
 * during upstream outages (#840).
 */

"use strict";

const { HORIZON_URL } = require("../config/stellar");

const STATES = Object.freeze({
  CLOSED: "closed",
  OPEN: "open",
  HALF_OPEN: "half_open",
});

/** @type {Readonly<{ failureThreshold: number, openDurationMs: number, halfOpenMaxProbes: number, maxOrigins: number }>} */
const DEFAULT_OPTIONS = Object.freeze({
  failureThreshold: 5,
  openDurationMs: 30_000,
  halfOpenMaxProbes: 1,
  maxOrigins: 8,
});

/**
 * Derive Stellar network label from a Horizon URL or STELLAR_NETWORK env.
 * @param {string} [horizonUrl]
 * @returns {"testnet" | "mainnet"}
 */
function inferNetworkFromHorizonUrl(horizonUrl = HORIZON_URL) {
  const configured = process.env.STELLAR_NETWORK?.trim().toLowerCase();
  if (configured === "mainnet" || configured === "testnet") {
    return configured;
  }
  return horizonUrl.includes("testnet") ? "testnet" : "mainnet";
}

/**
 * Normalize a Horizon URL to its origin key.
 * @param {string} horizonUrl
 * @returns {string}
 */
function toOriginKey(horizonUrl) {
  return new URL(horizonUrl).origin;
}

class HorizonCircuitOpenError extends Error {
  /**
   * @param {object} snapshot
   * @param {string} snapshot.origin
   * @param {"testnet" | "mainnet"} snapshot.network
   * @param {"open" | "half_open"} snapshot.state
   * @param {number} snapshot.retryAfterMs
   */
  constructor(snapshot) {
    super(
      `Horizon upstream unavailable (${snapshot.network}); circuit is ${snapshot.state}. Retry after ${snapshot.retryAfterMs} ms.`
    );
    this.name = "HorizonCircuitOpenError";
    this.code = "HORIZON_CIRCUIT_OPEN";
    this.status = 503;
    this.origin = snapshot.origin;
    this.network = snapshot.network;
    this.state = snapshot.state;
    this.retryAfterMs = snapshot.retryAfterMs;
    this.retryAfterSeconds = Math.max(1, Math.ceil(snapshot.retryAfterMs / 1000));
  }
}

/**
 * @typedef {object} BreakerSnapshot
 * @property {string} origin
 * @property {"testnet" | "mainnet"} network
 * @property {"closed" | "open" | "half_open"} state
 * @property {number} consecutiveFailures
 * @property {number} halfOpenProbes
 * @property {number|null} openedAt
 * @property {number|null} retryAfterMs
 * @property {number|null} lastFailureAt
 * @property {number|null} lastSuccessAt
 */

class HorizonOriginBreaker {
  /**
   * @param {string} origin
   * @param {string} horizonUrl
   * @param {typeof DEFAULT_OPTIONS} options
   */
  constructor(origin, horizonUrl, options) {
    this.origin = origin;
    this.horizonUrl = horizonUrl;
    this.network = inferNetworkFromHorizonUrl(horizonUrl);
    this.options = options;
    this.state = STATES.CLOSED;
    this.consecutiveFailures = 0;
    this.halfOpenProbes = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
    this.lastSuccessAt = null;
  }

  /** @returns {BreakerSnapshot} */
  snapshot() {
    return {
      origin: this.origin,
      network: this.network,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      halfOpenProbes: this.halfOpenProbes,
      openedAt: this.openedAt,
      retryAfterMs: this.getRetryAfterMs(),
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  /** @returns {number|null} */
  getRetryAfterMs() {
    if (this.state === STATES.CLOSED) return null;
    if (this.state === STATES.HALF_OPEN) return 0;

    const elapsed = Date.now() - (this.openedAt || 0);
    const remaining = this.options.openDurationMs - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  /** Transition open → half-open when cooldown elapses. */
  refreshState() {
    if (this.state !== STATES.OPEN || this.openedAt === null) return;
    if (Date.now() - this.openedAt >= this.options.openDurationMs) {
      this.state = STATES.HALF_OPEN;
      this.halfOpenProbes = 0;
    }
  }

  /** @throws {HorizonCircuitOpenError} */
  assertCanExecute() {
    this.refreshState();

    if (this.state === STATES.CLOSED) return;

    if (this.state === STATES.OPEN) {
      throw new HorizonCircuitOpenError(this.snapshot());
    }

    if (this.halfOpenProbes >= this.options.halfOpenMaxProbes) {
      throw new HorizonCircuitOpenError(this.snapshot());
    }

    this.halfOpenProbes += 1;
  }

  recordSuccess() {
    this.refreshState();
    this.consecutiveFailures = 0;
    this.halfOpenProbes = 0;
    this.openedAt = null;
    this.lastSuccessAt = Date.now();
    this.state = STATES.CLOSED;
  }

  recordFailure() {
    this.refreshState();
    this.consecutiveFailures += 1;
    this.lastFailureAt = Date.now();

    if (this.state === STATES.HALF_OPEN) {
      this.tripOpen();
      return;
    }

    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.tripOpen();
    }
  }

  tripOpen() {
    this.state = STATES.OPEN;
    this.openedAt = Date.now();
    this.halfOpenProbes = 0;
  }

  /** @visibleForTesting */
  reset() {
    this.state = STATES.CLOSED;
    this.consecutiveFailures = 0;
    this.halfOpenProbes = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
    this.lastSuccessAt = null;
  }
}

/** @type {Map<string, HorizonOriginBreaker>} */
const breakers = new Map();

/**
 * @param {string} [horizonUrl]
 * @param {Partial<typeof DEFAULT_OPTIONS>} [overrides]
 * @returns {HorizonOriginBreaker}
 */
function getBreaker(horizonUrl = HORIZON_URL, overrides = {}) {
  const origin = toOriginKey(horizonUrl);
  let breaker = breakers.get(origin);
  if (!breaker) {
    if (breakers.size >= DEFAULT_OPTIONS.maxOrigins) {
      const oldest = breakers.keys().next().value;
      breakers.delete(oldest);
    }
    breaker = new HorizonOriginBreaker(origin, horizonUrl, {
      ...DEFAULT_OPTIONS,
      ...overrides,
    });
    breakers.set(origin, breaker);
  }
  return breaker;
}

/**
 * Execute a Horizon call through the breaker for the given origin.
 * Fails fast with retry guidance when the circuit is open.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ horizonUrl?: string, operation?: string }} [context]
 * @returns {Promise<T>}
 */
async function executeThroughBreaker(fn, context = {}) {
  const breaker = getBreaker(context.horizonUrl || HORIZON_URL);
  breaker.assertCanExecute();

  try {
    const result = await fn();
    breaker.recordSuccess();
    return result;
  } catch (err) {
    breaker.recordFailure();
    throw err;
  }
}

/** @returns {BreakerSnapshot[]} */
function getAllBreakerStates() {
  for (const breaker of breakers.values()) {
    breaker.refreshState();
  }
  return [...breakers.values()].map((breaker) => breaker.snapshot());
}

function resetAllBreakers() {
  breakers.clear();
}

module.exports = {
  STATES,
  HorizonCircuitOpenError,
  inferNetworkFromHorizonUrl,
  toOriginKey,
  getBreaker,
  executeThroughBreaker,
  getAllBreakerStates,
  resetAllBreakers,
};

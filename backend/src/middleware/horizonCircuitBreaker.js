/**
 * src/middleware/horizonCircuitBreaker.js
 * Circuit breaker for Horizon API calls.
 *
 * Opens after 5 consecutive Horizon 5xx errors within 60 seconds.
 * Returns 503 Service Unavailable while open.
 * Probes every 30 seconds to detect recovery.
 *
 * Issue #1203 - feat: implement a circuit breaker for Horizon API calls
 * Emmy123222/Stellar-MicroPay
 */

"use strict";

// ─── Circuit Breaker States ───────────────────────────────────────────────────

/**
 * @typedef {"CLOSED" | "OPEN" | "HALF_OPEN"} CircuitBreakerState
 *
 * CLOSED  - Normal operation; requests pass through.
 * OPEN    - Horizon is deemed unavailable; short-circuit with 503.
 * HALF_OPEN - A probe request is in-flight to test recovery.
 */

const STATE = Object.freeze({
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
});

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  /** Number of consecutive 5xx errors required to open the circuit. */
  failureThreshold: 5,
  /** Window (ms) in which failures are counted. Errors older than this are ignored. */
  windowMs: 60_000,
  /** Interval (ms) between probe attempts when the circuit is OPEN. */
  probeIntervalMs: 30_000,
};

// ─── Shared Circuit Breaker State ─────────────────────────────────────────────

/** Timestamps (ms) of recent 5xx failures within the rolling window. */
let recentFailures = [];
let circuitState = STATE.CLOSED;
let probeTimer = null;
let lastOpenedAt = null;

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function now() {
  return Date.now();
}

/** Remove failures outside the rolling time window. */
function pruneOldFailures() {
  const cutoff = now() - CONFIG.windowMs;
  recentFailures = recentFailures.filter((ts) => ts > cutoff);
}

/** Record a new Horizon 5xx failure and open the circuit if threshold is hit. */
function recordFailure() {
  pruneOldFailures();
  recentFailures.push(now());

  if (
    circuitState === STATE.CLOSED &&
    recentFailures.length >= CONFIG.failureThreshold
  ) {
    openCircuit();
  }

  // A failure during HALF_OPEN sends us straight back to OPEN.
  if (circuitState === STATE.HALF_OPEN) {
    openCircuit();
  }
}

/** Record a successful Horizon response, closing the circuit if it was HALF_OPEN. */
function recordSuccess() {
  if (circuitState === STATE.HALF_OPEN) {
    closeCircuit();
  }
}

/** Transition to OPEN state and schedule a probe. */
function openCircuit() {
  circuitState = STATE.OPEN;
  lastOpenedAt = now();
  recentFailures = [];

  if (!probeTimer) {
    probeTimer = setInterval(scheduleProbe, CONFIG.probeIntervalMs);
  }
}

/** Transition to CLOSED state and cancel the probe timer. */
function closeCircuit() {
  circuitState = STATE.CLOSED;
  recentFailures = [];
  lastOpenedAt = null;
  clearInterval(probeTimer);
  probeTimer = null;
}

/**
 * Allow one probe request through by temporarily moving to HALF_OPEN.
 * The probe result (success/failure) will determine the next transition.
 */
function scheduleProbe() {
  if (circuitState === STATE.OPEN) {
    circuitState = STATE.HALF_OPEN;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Express middleware that short-circuits with 503 when the Horizon circuit is OPEN.
 * Attach this before any route handler that makes Horizon API calls.
 *
 * @param {import("express").Request}  req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function horizonCircuitBreakerMiddleware(req, res, next) {
  if (circuitState === STATE.OPEN) {
    return res.status(503).json({
      error: "Stellar network temporarily unavailable",
      retryAfter: Math.ceil(CONFIG.probeIntervalMs / 1000),
    });
  }
  next();
}

/**
 * Wrap an async Horizon call with circuit-breaker tracking.
 *
 * @template T
 * @param {() => Promise<T>} horizonCall - A zero-argument async function that calls Horizon.
 * @returns {Promise<T>} The resolved value, or throws the original error after recording it.
 *
 * @example
 * const account = await withCircuitBreaker(() => server.loadAccount(publicKey));
 */
async function withCircuitBreaker(horizonCall) {
  if (circuitState === STATE.OPEN) {
    const err = new Error("Stellar network temporarily unavailable");
    err.status = 503;
    throw err;
  }

  try {
    const result = await horizonCall();
    recordSuccess();
    return result;
  } catch (err) {
    const status = err?.response?.status || err?.status || 0;
    if (status >= 500 && status < 600) {
      recordFailure();
    }
    throw err;
  }
}

/**
 * Retrieve the current circuit state (for observability / health endpoints).
 *
 * @returns {{ state: CircuitBreakerState, failures: number, lastOpenedAt: number | null }}
 */
function getCircuitStatus() {
  pruneOldFailures();
  return {
    state: circuitState,
    failures: recentFailures.length,
    lastOpenedAt,
  };
}

/**
 * Reset the circuit breaker to its initial CLOSED state.
 * Primarily for testing.
 */
function resetCircuit() {
  recentFailures = [];
  circuitState = STATE.CLOSED;
  lastOpenedAt = null;
  clearInterval(probeTimer);
  probeTimer = null;
}

/**
 * Expose internal configuration mutation for testing.
 * @param {Partial<typeof CONFIG>} overrides
 */
function _setConfigForTesting(overrides) {
  Object.assign(CONFIG, overrides);
}

/**
 * Force a specific state for testing.
 * @param {CircuitBreakerState} state
 */
function _forceStateForTesting(state) {
  circuitState = state;
}

module.exports = {
  horizonCircuitBreakerMiddleware,
  withCircuitBreaker,
  getCircuitStatus,
  resetCircuit,
  recordFailure,
  recordSuccess,
  STATE,
  _setConfigForTesting,
  _forceStateForTesting,
};

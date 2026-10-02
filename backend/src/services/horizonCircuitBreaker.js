/**
 * src/services/horizonCircuitBreaker.js
 * Minimal circuit breaker guarding outbound Horizon calls.
 *
 * States:
 *   closed    — calls pass through; consecutive failures are counted.
 *   open      — calls are rejected immediately with a 503 until the
 *               reset timeout elapses. This protects the API from piling
 *               more requests onto an already-failing Horizon.
 *   half-open — a single probe call is allowed through. Success closes the
 *               circuit; failure re-opens it and restarts the timeout.
 */

"use strict";

const STATE = {
  CLOSED: "closed",
  OPEN: "open",
  HALF_OPEN: "half-open",
};

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT = 30 * 1000;

const failureThreshold = Number(
  process.env.HORIZON_BREAKER_FAILURE_THRESHOLD || DEFAULT_FAILURE_THRESHOLD
);
const resetTimeout = Number(
  process.env.HORIZON_BREAKER_RESET_TIMEOUT || DEFAULT_RESET_TIMEOUT
);

let state = STATE.CLOSED;
let consecutiveFailures = 0;
let openedAt = 0;
let probeInFlight = false;

/**
 * Current breaker state snapshot.
 * @returns {{state: string, consecutiveFailures: number}}
 */
function getState() {
  return { state, consecutiveFailures };
}

/**
 * Restores the breaker to its initial closed state.
 * Exposed for tests and for manual recovery.
 */
function reset() {
  state = STATE.CLOSED;
  consecutiveFailures = 0;
  openedAt = 0;
  probeInFlight = false;
}

/**
 * Moves an expired open circuit into half-open so a probe can be attempted.
 */
function refreshState() {
  if (state === STATE.OPEN && Date.now() - openedAt >= resetTimeout) {
    state = STATE.HALF_OPEN;
    probeInFlight = false;
  }
}

/**
 * Records a successful call, closing the circuit.
 */
function recordSuccess() {
  state = STATE.CLOSED;
  consecutiveFailures = 0;
  probeInFlight = false;
}

/**
 * Records a failure, opening the circuit once the threshold is reached.
 * @param {boolean} [countFailure=true] - False for outcomes that are not
 *   infrastructure failures (e.g. a 404 for an unfunded account).
 */
function recordFailure(countFailure = true) {
  probeInFlight = false;

  if (!countFailure) {
    // Horizon answered (e.g. 404 for an account that is not funded yet).
    // The round-tripped, so treat it as evidence of liveness and close the
    // circuit rather than letting it linger in half-open.
    recordSuccess();
    return;
  }

  if (state === STATE.HALF_OPEN) {
    // The probe failed — go straight back to open and restart the timeout.
    state = STATE.OPEN;
    openedAt = Date.now();
    return;
  }

  consecutiveFailures += 1;

  if (consecutiveFailures >= failureThreshold) {
    state = STATE.OPEN;
    openedAt = Date.now();
  }
}

function openCircuitError() {
  const error = new Error(
    "Stellar Horizon is temporarily unavailable. Please try again shortly."
  );
  error.status = 503;
  return error;
}

/**
 * Whether a call is currently permitted.
 * @returns {boolean}
 */
function allowsRequest() {
  refreshState();

  if (state === STATE.CLOSED) {
    return true;
  }

  if (state === STATE.OPEN) {
    return false;
  }

  // half-open — admit a single probe
  if (probeInFlight) {
    return false;
  }
  probeInFlight = true;
  return true;
}

/**
 * Runs `fn` through the breaker.
 *
 * @param {Function} fn - Async function performing the Horizon call
 * @param {object} [options]
 * @param {Function} [options.isFailure] - Predicate receiving the thrown
 *   error; return false to treat it as a non-failure outcome.
 * @returns {Promise<*>} The result of `fn`
 * @throws {Error} With `status = 503` when the circuit is open
 */
async function exec(fn, { isFailure } = {}) {
  if (!allowsRequest()) {
    throw openCircuitError();
  }

  try {
    const result = await fn();
    recordSuccess();
    return result;
  } catch (err) {
    const countFailure = typeof isFailure === "function" ? Boolean(isFailure(err)) : true;
    recordFailure(countFailure);
    throw err;
  }
}

module.exports = {
  exec,
  getState,
  reset,
  STATE,
};

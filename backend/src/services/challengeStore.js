/**
 * src/services/challengeStore.js
 *
 * Durable (in-process) one-time-use store for SEP-0010 challenge transactions.
 *
 * Design goals
 * ────────────
 *  • Each challenge is stored by its unique id (the transaction's source-account
 *    sequence number encoded as a hex string) together with the subject public key,
 *    the network passphrase, the wall-clock expiry, and a boolean consumed flag.
 *  • `consumeChallenge` is the only way to mark a challenge as used.  It checks
 *    existence, expiry, and consumed state in a single synchronous step, then
 *    immediately sets consumed=true before returning — giving atomic "test-and-set"
 *    semantics within a single Node.js event-loop tick (no concurrent JS can
 *    interleave between the check and the mutation).
 *  • A periodic sweeper removes entries that have both expired and been consumed
 *    (or just expired with a safety buffer) so the Map does not grow without bound.
 *
 * Replay-prevention guarantee
 * ───────────────────────────
 *  After `storeChallenge` is called once, any subsequent call to `consumeChallenge`
 *  with the same id will fail — whether the second call comes from the same request,
 *  a retry, or a second replica sharing the same process (horizontal scale-out
 *  across separate processes requires a shared store such as Redis; this module is
 *  intentionally in-process, matching the project's current infrastructure).
 */
"use strict";

/**
 * @typedef {Object} ChallengeRecord
 * @property {string}  id        - Unique identifier derived from the XDR transaction
 * @property {string}  subject   - Stellar public key of the authenticating account
 * @property {string}  network   - Network passphrase the challenge was built for
 * @property {number}  expiresAt - Unix epoch milliseconds when the challenge expires
 * @property {boolean} consumed  - true once the challenge has been successfully verified
 */

/** @type {Map<string, ChallengeRecord>} */
const challenges = new Map();

// Sweep interval: clean up stale entries every 60 seconds.
const SWEEP_INTERVAL_MS = 60_000;
// Keep an expired-but-unconsumed entry for this long before sweeping it, so
// clock-skew and in-flight requests have a window to complete.
const EXPIRED_GRACE_MS = 30_000;

let sweepTimer = null;

/**
 * Store a newly issued challenge.
 *
 * @param {Object} opts
 * @param {string} opts.id        - Unique challenge id
 * @param {string} opts.subject   - Stellar public key of the authenticating account
 * @param {string} opts.network   - Network passphrase
 * @param {number} opts.expiresAt - Unix epoch ms when the challenge expires
 * @returns {ChallengeRecord} The stored record
 */
function storeChallenge({ id, subject, network, expiresAt }) {
  if (!id || !subject || !network || typeof expiresAt !== "number") {
    throw new TypeError(
      "storeChallenge requires id, subject, network (string) and expiresAt (number)"
    );
  }
  const record = { id, subject, network, expiresAt, consumed: false };
  challenges.set(id, record);
  return record;
}

/**
 * Atomically consume a challenge during verification.
 *
 * Within a single Node.js event-loop tick (single-threaded JS), the read and
 * the write are guaranteed to be uninterrupted — making this a safe test-and-set
 * for the single-process case.
 *
 * @param {Object} opts
 * @param {string} opts.id      - Challenge id to consume
 * @param {string} opts.subject - Expected subject (account public key); must match stored value
 * @param {string} opts.network - Expected network passphrase; must match stored value
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function consumeChallenge({ id, subject, network }) {
  const record = challenges.get(id);

  if (!record) {
    return { ok: false, reason: "challenge_not_found" };
  }

  if (record.consumed) {
    return { ok: false, reason: "challenge_already_consumed" };
  }

  if (Date.now() > record.expiresAt) {
    return { ok: false, reason: "challenge_expired" };
  }

  if (record.subject !== subject) {
    return { ok: false, reason: "challenge_subject_mismatch" };
  }

  if (record.network !== network) {
    return { ok: false, reason: "challenge_network_mismatch" };
  }

  // Mark consumed before returning — any subsequent call for this id will see
  // consumed=true and be rejected.
  record.consumed = true;
  return { ok: true };
}

/**
 * Look up a challenge record without consuming it (useful for debugging / tests).
 *
 * @param {string} id
 * @returns {ChallengeRecord | undefined}
 */
function getChallenge(id) {
  return challenges.get(id);
}

/**
 * Remove stale entries from the store.
 * Called automatically by the background timer; also exported so tests can
 * trigger it synchronously.
 */
function sweep() {
  const now = Date.now();
  for (const [id, record] of challenges) {
    // Remove if expired beyond grace window (consumed or not).
    if (now > record.expiresAt + EXPIRED_GRACE_MS) {
      challenges.delete(id);
    }
  }
}

/**
 * Return the current number of tracked challenges (consumed + active).
 * Exposed for tests and health checks.
 * @returns {number}
 */
function size() {
  return challenges.size;
}

/**
 * Start the periodic sweep timer.
 * Safe to call multiple times — subsequent calls are no-ops.
 * @returns {void}
 */
function startSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Allow the process to exit even if this timer is still running.
  if (sweepTimer.unref) sweepTimer.unref();
}

/**
 * Stop the sweep timer and clear the store.
 * Primarily for test teardown.
 * @returns {void}
 */
function reset() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  challenges.clear();
}

// Start the sweeper on module load so the store self-manages in production.
startSweep();

module.exports = {
  storeChallenge,
  consumeChallenge,
  getChallenge,
  sweep,
  size,
  startSweep,
  reset,
  // Exported for tests only — direct map access is intentionally not exported.
  _SWEEP_INTERVAL_MS: SWEEP_INTERVAL_MS,
  _EXPIRED_GRACE_MS: EXPIRED_GRACE_MS,
};

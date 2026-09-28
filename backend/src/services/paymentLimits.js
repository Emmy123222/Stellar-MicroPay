/**
 * src/services/paymentLimits.js
 * Network-derived minimums for anything that moves value.
 *
 * A payment smaller than the fee needed to settle it is pure cost: it still
 * pays the base fee, still lands in the ledger, and still has to be indexed.
 * Stellar's base fee is 100 stroops, so the floor below is where a transfer
 * stops being worth a block of its own — and rejecting it is also the cheap
 * answer to the dust attacks that aim to bury an account under entries it
 * cannot afford to merge away.
 */

"use strict";

/** Stroops in one XLM, per the Stellar amount convention. */
const STROOPS_PER_XLM = 10_000_000;

/** Network base fee in stroops. */
const BASE_FEE_STROOPS = 100;

/**
 * Smallest payment accepted, in stroops: ten times the base fee. The extra
 * margin keeps a payment from being dwarfed by the overhead of the operations
 * that usually accompany it (memo, trustline, offer).
 */
const MIN_PAYMENT_STROOPS = 1_000;

/** The same floor expressed in XLM, for error messages and API docs. */
const MIN_PAYMENT_XLM = MIN_PAYMENT_STROOPS / STROOPS_PER_XLM;

/**
 * The message every endpoint returns for a dust amount. Kept here so a caller
 * can pattern-match one string instead of one string per route.
 */
const MIN_PAYMENT_ERROR = `Amount too small — minimum payment is ${MIN_PAYMENT_XLM} XLM`;

/**
 * Convert an amount to stroops. Amounts arrive as strings from the frontend
 * (Horizon's own representation) and as numbers from tests and internal
 * callers, so both are accepted.
 *
 * @param {string|number} amount
 * @returns {number|null} stroops, or null when the value is not a number
 */
function toStroops(amount) {
  if (typeof amount === "string") {
    amount = amount.trim();
    if (amount === "") {
      return null;
    }
  }
  const asNumber = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(asNumber)) {
    return null;
  }
  // Round, not truncate: "0.0001" is 999.9999... in binary floating point, and
  // a boundary value must not be failed by the representation of it.
  return Math.round(asNumber * STROOPS_PER_XLM);
}

/**
 * True when `amount` is below the accepted floor (or not a usable amount at
 * all). `null` means "no amount was given" — the caller's required-field check
 * owns that error, so it is reported here as *not* dust rather than doubling up
 * with a misleading message.
 *
 * @param {string|number} amount
 * @returns {boolean}
 */
function isDustAmount(amount) {
  const stroops = toStroops(amount);
  if (stroops === null) {
    return false;
  }
  return stroops < MIN_PAYMENT_STROOPS;
}

/**
 * Throw the 400 an endpoint should return for a dust amount.
 *
 * @param {string|number} amount
 * @throws {Error} `status` 400 and `message` equal to MIN_PAYMENT_ERROR
 */
function assertNotDust(amount) {
  if (isDustAmount(amount)) {
    const error = new Error(MIN_PAYMENT_ERROR);
    error.status = 400;
    throw error;
  }
}

module.exports = {
  STROOPS_PER_XLM,
  BASE_FEE_STROOPS,
  MIN_PAYMENT_STROOPS,
  MIN_PAYMENT_XLM,
  MIN_PAYMENT_ERROR,
  toStroops,
  isDustAmount,
  assertNotDust,
};

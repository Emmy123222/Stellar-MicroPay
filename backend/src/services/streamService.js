/**
 * src/services/streamService.js
 * Reads streaming-payment channel state from the deployed Soroban contract (#1066).
 *
 * The contract stores each stream under the persistent ledger key
 * `DataKey::Stream(u32)` as a `Stream` struct:
 *   { payer, recipients: [{ recipient, weight, claimed }], rate_per_ledger,
 *     deposited, start_ledger, token, paused, paused_at_ledger,
 *     paused_ledgers, closed }
 *
 * Accrual is derived on-chain (never stored), so `claimableNow` mirrors the
 * contract's `total_streamed_amount` logic here: elapsed ledgers exclude
 * paused ones and are capped at the funded window (`deposited / rate_per_ledger`).
 */

"use strict";

const { xdr, scValToNative } = require("@stellar/stellar-sdk");
const { server, getContractId } = require("../config/soroban");

const STREAM_DURABILITY = "persistent";

/** Error thrown when the contract has no entry for the requested stream id. */
class StreamNotFoundError extends Error {
  constructor(streamId) {
    super(`Stream ${streamId} not found`);
    this.name = "StreamNotFoundError";
    this.status = 404;
  }
}

/** Thrown when the contract ID env var is not configured. */
class ContractNotConfiguredError extends Error {
  constructor() {
    super("CONTRACT_ID is not configured — set it to the deployed MicroPay contract ID");
    this.name = "ContractNotConfiguredError";
    this.status = 503;
  }
}

/**
 * Validate and normalize a stream id (must be a u32).
 *
 * @param {string|number} rawStreamId
 * @returns {number}
 */
function parseStreamId(rawStreamId) {
  const raw = String(rawStreamId);
  if (!/^\d+$/.test(raw)) {
    const err = new Error("streamId must be an unsigned 32-bit integer");
    err.status = 400;
    throw err;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    const err = new Error("streamId must be an unsigned 32-bit integer");
    err.status = 400;
    throw err;
  }
  return parsed;
}

/**
 * Convert an amount (string/number/BigInt) into BigInt, defaulting to 0 on
 * unparseable input — contract amounts are i128 and always well-formed, so
 * this only guards against null/undefined from partial decodes.
 */
function toBigInt(value) {
  if (value === null || value === undefined) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * Sum `claimed` across all recipients of a stream.
 */
function totalClaimed(recipients) {
  return (recipients || []).reduce((sum, r) => sum + toBigInt(r?.claimed), 0n);
}

/**
 * Mirror the contract's accrual: how many tokens have streamed but not yet
 * been claimed, across all recipients, as of `currentLedger`.
 *
 * @param {object} stream - native (scValToNative) Stream struct
 * @param {number} currentLedger
 * @returns {bigint}
 */
function computeClaimableNow(stream, currentLedger) {
  if (stream.closed) return 0n;

  const rate = toBigInt(stream.rate_per_ledger);
  const deposited = toBigInt(stream.deposited);
  if (rate <= 0n) return 0n;

  const pausedTotal = stream.paused
    ? Number(stream.paused_ledgers || 0) +
      Math.max(0, currentLedger - Number(stream.paused_at_ledger || 0))
    : Number(stream.paused_ledgers || 0);

  let elapsed = Math.max(0, currentLedger - Number(stream.start_ledger || 0) - pausedTotal);

  // Cap the accrual window at the funded window (deposited / rate).
  const fundedLedgers = deposited / rate;
  if (BigInt(elapsed) > fundedLedgers) {
    elapsed = Number(fundedLedgers);
  }

  const totalStreamed = rate * BigInt(elapsed);
  const claimable = totalStreamed - totalClaimed(stream.recipients);
  return claimable > 0n ? claimable : 0n;
}

/**
 * Build the `DataKey::Stream(u32)` storage key ScVal. The contract's
 * `#[contracttype] DataKey` enum encodes as
 * `scvVec [ scvSymbol("Stream"), scvU32(id) ]`.
 *
 * @param {number} streamId
 */
function streamKeyScVal(streamId) {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Stream"),
    xdr.ScVal.scvU32(streamId),
  ]);
}

function isMissingDataError(err) {
  const msg = String(err?.message || "");
  return /does not exist|not found|lookup failed|Data for contract/i.test(msg);
}

/**
 * Read a stream's current state from the contract and map it to the API shape.
 *
 * @param {number|string} streamId - u32 stream id
 * @returns {Promise<{ payer: string, recipient: string|null, ratePerLedger: string,
 *   deposited: string, claimed: string, startLedger: number, claimableNow: string }>}
 * @throws {StreamNotFoundError} 404 when the stream id has no contract entry
 * @throws {ContractNotConfiguredError} 503 when CONTRACT_ID is unset
 */
async function getStreamStatus(streamId) {
  const contractId = getContractId();
  if (!contractId) {
    throw new ContractNotConfiguredError();
  }

  const id = parseStreamId(streamId);
  const key = streamKeyScVal(id);

  let entry;
  try {
    entry = await server.getContractData(contractId, key, STREAM_DURABILITY);
  } catch (err) {
    if (isMissingDataError(err)) {
      throw new StreamNotFoundError(id);
    }
    throw err;
  }

  // An archived/deleted entry surfaces as a void ScVal — treat it as absent.
  if (!entry?.val || entry.val.switch?.() === undefined) {
    throw new StreamNotFoundError(id);
  }
  try {
    if (entry.val.switch().name === "scvVoid") {
      throw new StreamNotFoundError(id);
    }
  } catch (err) {
    if (err instanceof StreamNotFoundError) throw err;
    // Non-XDR mock shapes in tests fall through to scValToNative below.
  }

  const stream = scValToNative(entry.val);
  if (!stream || stream.payer === undefined) {
    throw new StreamNotFoundError(id);
  }

  let currentLedger = Number(stream.start_ledger || 0);
  try {
    const latest = await server.getLatestLedger();
    if (latest?.sequence != null) {
      currentLedger = Number(latest.sequence);
    }
  } catch {
    // Fall back to start_ledger (claimableNow will read 0) so the endpoint
    // still returns the stored state when the ledger query is unavailable.
  }

  const recipients = Array.isArray(stream.recipients) ? stream.recipients : [];

  return {
    payer: stream.payer,
    recipient: recipients.length > 0 ? recipients[0].recipient : null,
    ratePerLedger: toBigInt(stream.rate_per_ledger).toString(),
    deposited: toBigInt(stream.deposited).toString(),
    claimed: totalClaimed(recipients).toString(),
    startLedger: Number(stream.start_ledger || 0),
    claimableNow: computeClaimableNow(stream, currentLedger).toString(),
  };
}

module.exports = {
  getStreamStatus,
  parseStreamId,
  computeClaimableNow,
  streamKeyScVal,
  StreamNotFoundError,
  ContractNotConfiguredError,
};

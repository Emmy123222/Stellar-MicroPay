/**
 * src/services/stellarService.js
 * Business logic for interacting with the Stellar Horizon API.
 * All blockchain reads happen here — this is the single source of truth.
 */

"use strict";

const { Horizon } = require("@stellar/stellar-sdk");
require("dotenv").config();

const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

const server = new Horizon.Server(HORIZON_URL);
const FEE_CACHE_TTL = 10 * 1000;
let feeCache = { data: null, timestamp: 0 };

function parseStroops(value, fallback = 100) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ─── Account ──────────────────────────────────────────────────────────────────

/**
 * Load a Stellar account and return its balances.
 */
async function getAccount(publicKey) {
  validatePublicKey(publicKey);

  try {
    const account = await server.loadAccount(publicKey);

    const balances = account.balances.map((b) => {
      if (b.asset_type === "native") {
        return { assetCode: "XLM", balance: b.balance, asset_type: "native" };
      }
      return {
        assetCode: b.asset_code,
        balance: b.balance,
        assetIssuer: b.asset_issuer,
        asset_type: b.asset_type,
      };
    });

    return {
      publicKey,
      sequence: account.sequence,
      balances,
      subentryCount: account.subentry_count,
    };
  } catch (err) {
    if (err?.response?.status === 404) {
      const error = new Error(
        "Account not found. It may not be funded yet. Use Friendbot on testnet."
      );
      error.status = 404;
      throw error;
    }
    throw err;
  }
}

/**
 * Get only the native XLM balance.
 */
async function getXLMBalance(publicKey) {
  const { balances } = await getAccount(publicKey);
  const xlm = balances.find((b) => b.assetCode === "XLM");
  return xlm ? xlm.balance : "0";
}

// ─── Network Fee Stats ────────────────────────────────────────────────────────

/**
 * Fetch current Horizon fee statistics and return a simplified recommendation.
 * Results are cached for 10 seconds to avoid hammering Horizon.
 */
async function getFeeStats() {
  const now = Date.now();

  if (feeCache.data && now - feeCache.timestamp < FEE_CACHE_TTL) {
    return feeCache.data;
  }

  const response = await fetch(`${HORIZON_URL.replace(/\/$/, "")}/fee_stats`);

  if (!response.ok) {
    throw new Error(`Horizon fee_stats returned ${response.status}`);
  }

  const payload = await response.json();
  const feeCharged = payload?.fee_charged || {};
  const baseFee = parseStroops(feeCharged.mode, 100);
  const data = {
    baseFee,
    feeCharged: {
      p10: parseStroops(feeCharged.p10, baseFee),
      p50: parseStroops(feeCharged.p50, baseFee),
      p90: parseStroops(feeCharged.p90, baseFee),
    },
  };

  feeCache = { data, timestamp: Date.now() };
  return data;
}

// ─── Payments ─────────────────────────────────────────────────────────────────

/**
 * Fetch payment history for an account from Horizon.
 *
 * @param {string} publicKey
 * @param {{ limit?: number, cursor?: string }} options
 */
async function getPayments(publicKey, { limit = 20, cursor } = {}) {
  validatePublicKey(publicKey);

  let query = server.payments().forAccount(publicKey).limit(limit).order("desc");

  if (cursor) {
    query = query.cursor(cursor);
  }

  const result = await query.call();

  const payments = [];

  for (const op of result.records) {
    if (op.type !== "payment") continue;

    const assetCode =
      op.asset_type === "native" ? "XLM" : op.asset_code || "UNKNOWN";

    let memo;
    try {
      const tx = await op.transaction();
      if (tx.memo_type === "text" && tx.memo) {
        memo = tx.memo;
      }
    } catch {
      // memo is optional
    }

    payments.push({
      id: op.id,
      type: op.from === publicKey ? "sent" : "received",
      amount: op.amount,
      asset: assetCode,
      from: op.from,
      to: op.to,
      memo,
      createdAt: op.created_at,
      transactionHash: op.transaction_hash,
      pagingToken: op.paging_token,
    });
  }

  return payments;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validatePublicKey(publicKey) {
  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const err = new Error("Invalid Stellar public key format");
    err.status = 400;
    throw err;
  }
}

module.exports = {
  getAccount,
  getXLMBalance,
  getFeeStats,
  getPayments,
  validatePublicKey,
};

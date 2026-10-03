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

const USDC_ISSUERS = new Set(
  (process.env.USDC_ISSUER || "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

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

/**
 * Check whether an account has a USDC trustline.
 * Returns true if any balance entry has asset_code === "USDC".
 */
async function hasUSDCTrustline(publicKey) {
  validatePublicKey(publicKey);

  try {
    const account = await server.loadAccount(publicKey);
    return (account.balances || []).some((b) => {
      if (b.asset_type === "native") return false;
      if (b.asset_code !== "USDC") return false;
      // If USDC_ISSUER allowlist is configured, enforce it; otherwise accept any USDC issuer.
      if (USDC_ISSUERS.size > 0 && b.asset_issuer && !USDC_ISSUERS.has(b.asset_issuer)) {
        return false;
      }
      return true;
    });
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

/**
 * Submit a signed transaction envelope to Horizon.
 *
 * @param {string} signedXDR - Base64 signed transaction XDR.
 * @returns {Promise<{ hash: string, ledger: number, successful: boolean }>}
 */
async function submitTransaction(signedXDR) {
  if (!signedXDR || typeof signedXDR !== "string") {
    const error = new Error("signedXDR is required");
    error.status = 400;
    throw error;
  }

  // Resolved lazily so the SDK surface is only touched when submitting.
  const { TransactionBuilder, Networks } = require("@stellar/stellar-sdk");
  const networkPassphrase =
    process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

  let transaction;
  try {
    transaction = TransactionBuilder.fromXDR(signedXDR, networkPassphrase);
  } catch {
    const error = new Error("Invalid transaction XDR");
    error.status = 400;
    throw error;
  }

  try {
    const result = await server.submitTransaction(transaction);
    return {
      hash: result.hash,
      ledger: result.ledger,
      successful: result.successful !== false,
    };
  } catch (err) {
    const resultCodes = err?.response?.data?.extras?.result_codes;
    if (resultCodes) {
      const error = new Error(`Transaction failed: ${JSON.stringify(resultCodes)}`);
      error.status = 400;
      throw error;
    }
    throw err;
  }
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
  getPayments,
  hasUSDCTrustline,
  submitTransaction,
  validatePublicKey,
};

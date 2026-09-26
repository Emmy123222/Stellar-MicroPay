/**
 * src/services/stellarService.js
 * Business logic for interacting with the Stellar Horizon API.
 * All blockchain reads happen here — this is the single source of truth.
 */

"use strict";

const { server } = require("../config/stellar");
const logger = require("../utils/logger");

// ─── In-memory LRU cache for getAccount (5 s TTL) ────────────────────────────
const ACCOUNT_CACHE_TTL_MS = 5_000;
const ACCOUNT_CACHE_MAX = 256;

// ─── In-memory LRU cache for getAccountStreaks (1 hour TTL) ─────────────────
const STREAKS_CACHE_TTL_MS = 60 * 60 * 1000;
const STREAKS_CACHE_MAX = 1000;

// ─── Timeout + retry ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const PAYMENT_TYPES = new Set([
  "payment",
  "path_payment_strict_send",
  "path_payment_strict_receive",
]);

function isTransientError(err) {
  if (!err) return false;
  const status = err?.response?.status ?? err?.status;
  if (status === 404) return false; // definitive — don't retry
  if (status >= 500) return true;
  const msg = err?.message || "";
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("network") ||
    err.name === "AbortError"
  );
}

/**
 * Run `fn` with a hard timeout and retry up to MAX_RETRIES times on
 * transient errors, using exponential back-off (100 ms × 2^attempt).
 */
async function withTimeoutAndRetry(fn, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await Promise.race([
        fn(controller.signal),
        new Promise((_, reject) =>
          controller.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("Horizon request timed out"), { name: "AbortError" }))
          )
        ),
      ]);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (!isTransientError(err) || attempt === MAX_RETRIES) throw err;
      // Exponential back-off: 100 ms, 200 ms, 400 ms …
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw lastErr;
}

/** @type {Map<string, { value: object, expiresAt: number }>} */
const accountCache = new Map();

function cacheGet(key) {
  const entry = accountCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    accountCache.delete(key);
    return null;
  }
  // LRU: re-insert to move to end
  accountCache.delete(key);
  accountCache.set(key, entry);
  return entry.value;
}

function cacheSet(key, value) {
  if (accountCache.size >= ACCOUNT_CACHE_MAX) {
    // Evict the oldest entry (first key in insertion order)
    accountCache.delete(accountCache.keys().next().value);
  }
  accountCache.set(key, { value, expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS });
}

function clearAccountCache() {
  accountCache.clear();
}

/** @type {Map<string, { value: object, expiresAt: number }>} */
const streaksCache = new Map();

function clearStreaksCache() {
  streaksCache.clear();
}

// ─── Account ──────────────────────────────────────────────────────────────────

/**
 * Load a Stellar account and return its balances.
 */
async function getAccount(publicKey) {
  validatePublicKey(publicKey);

  const cached = cacheGet(publicKey);
  if (cached) return cached;

  try {
    const account = await withTimeoutAndRetry(() => server.loadAccount(publicKey));

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

    const result = {
      publicKey,
      sequence: account.sequence,
      balances,
      subentryCount: account.subentry_count,
    };

    cacheSet(publicKey, result);
    return result;
  } catch (err) {
    if (err?.response?.status === 404) {
      const error = new Error(
        "Account not found. It may not be funded yet. Use Friendbot on testnet."
      );
      error.status = 404;
      logger.error({ err: error, publicKey: publicKey.replace(/[\r\n]/g, "") }, "Account not found");
      throw error;
    }
    logger.error({ err, publicKey: publicKey.replace(/[\r\n]/g, "") }, "Error loading account from Horizon");
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
 * Get account streaks based on last 200 payments
 */
async function getAccountStreaks(publicKey) {
  validatePublicKey(publicKey);

  const cached = streaksCache.get(publicKey);
  if (cached) {
    if (Date.now() <= cached.expiresAt) {
      // LRU: re-insert to move to end
      streaksCache.delete(publicKey);
      streaksCache.set(publicKey, cached);
      return cached.value;
    }
    streaksCache.delete(publicKey);
  }

  const query = server.payments().forAccount(publicKey).limit(200).order("desc");
  const result = await withTimeoutAndRetry(() => query.call());

  const dates = new Set();
  let lastTransactionDate = null;

  for (const op of result.records) {
    if (!PAYMENT_TYPES.has(op.type)) continue;
    if (!lastTransactionDate) {
      lastTransactionDate = op.created_at;
    }
    const d = new Date(op.created_at);
    const dateStr = d.toISOString().split("T")[0];
    dates.add(dateStr);
  }

  const sortedDates = Array.from(dates).sort((a, b) => b.localeCompare(a));

  let currentStreak = 0;
  let longestStreak = 0;

  if (sortedDates.length > 0) {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Current streak
    if (sortedDates[0] === todayStr || sortedDates[0] === yesterdayStr) {
      currentStreak = 1;
      let prevDate = new Date(sortedDates[0]);
      for (let i = 1; i < sortedDates.length; i++) {
        const d = new Date(sortedDates[i]);
        const diffDays = Math.round((prevDate.getTime() - d.getTime()) / (1000 * 3600 * 24));
        if (diffDays === 1) {
          currentStreak++;
          prevDate = d;
        } else {
          break;
        }
      }
    }

    // Longest streak
    let max = 0;
    let currentCount = 0;
    let prev = null;

    for (let i = 0; i < sortedDates.length; i++) {
      const d = new Date(sortedDates[i]);
      if (!prev) {
        currentCount = 1;
        prev = d;
        max = 1;
      } else {
        const diffDays = Math.round((prev.getTime() - d.getTime()) / (1000 * 3600 * 24));
        if (diffDays === 1) {
          currentCount++;
          prev = d;
        } else {
          currentCount = 1;
          prev = d;
        }
        if (currentCount > max) {
          max = currentCount;
        }
      }
    }
    longestStreak = max;
  }

  const streaksData = {
    currentStreak,
    longestStreak,
    lastTransactionDate,
  };

  if (streaksCache.size >= STREAKS_CACHE_MAX) {
    streaksCache.delete(streaksCache.keys().next().value);
  }
  streaksCache.set(publicKey, {
    value: streaksData,
    expiresAt: Date.now() + STREAKS_CACHE_TTL_MS,
  });

  return streaksData;
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

  const result = await withTimeoutAndRetry(() => query.call());

  const payments = [];

  for (const op of result.records) {
    if (!PAYMENT_TYPES.has(op.type)) continue;
    const payment = await normalizePaymentOperation(op, publicKey);

    let memo;
    try {
      const tx = await withTimeoutAndRetry(() => op.transaction());
      if (tx.memo_type === "text" && tx.memo) {
        memo = tx.memo;
      }
    } catch (err) {
      logger.error({ err, transactionHash: op.transaction_hash }, "Failed to fetch memo for transaction");
      // memo is optional
    }

    payments.push({ ...payment, memo });
  }

  return payments;
}

/**
 * Stream new payment operations for a public key.
 *
 * Horizon handles reconnection internally. The caller receives normalized
 * payment records for both payment and path-payment operations.
 */
function streamPaymentEvents(publicKey, { onPayment, onError } = {}) {
  validatePublicKey(publicKey);

  const close = server
    .payments()
    .forAccount(publicKey)
    .order("asc")
    .cursor("now")
    .stream({
      onmessage: async (op) => {
        if (!PAYMENT_TYPES.has(op.type)) return;

        try {
          const payment = await normalizePaymentOperation(op, publicKey);
          onPayment?.(payment);
        } catch (error) {
          onError?.(error);
        }
      },
      onerror: (error) => {
        logger.error({ err: error, publicKey }, "Payment stream error");
        onError?.(error);
      },
    });

  return () => {
    try {
      close?.();
    } catch {
      // swallow errors on close
    }
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function normalizePaymentOperation(op, publicKey) {
  const isPathPayment = op.type !== "payment";
  const isSent = op.from === publicKey;

  let assetCode;
  if (isPathPayment && !isSent) {
    assetCode =
      op.dest_asset_type === "native" ? "XLM" : op.dest_asset_code || "UNKNOWN";
  } else {
    assetCode =
      op.asset_type === "native" ? "XLM" : op.asset_code || "UNKNOWN";
  }

  const amount = isPathPayment && !isSent ? op.dest_amount : op.amount;

  return {
    id: op.id,
    type: isSent ? "sent" : "received",
    amount,
    asset: assetCode,
    from: op.from,
    to: op.to,
    createdAt: op.created_at,
    transactionHash: op.transaction_hash,
    pagingToken: op.paging_token,
  };
}

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
  streamPaymentEvents,
  validatePublicKey,
  clearAccountCache,
  clearStreaksCache,
  getAccountStreaks,
};

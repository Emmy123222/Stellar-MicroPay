/**
 * src/services/stellarService.js
 * Business logic for interacting with the Stellar Horizon API.
 * All blockchain reads happen here — this is the single source of truth.
 *
 * Network note (#809): defaults to testnet via `HORIZON_URL` unless overridden by
 * env. Horizon traffic uses `@stellar/stellar-sdk` with a patched axios override.
 */

"use strict";

const { server, HORIZON_URL } = require("../config/stellar");
const logger = require("../utils/logger");
const {
  STATES,
  getBreaker,
  HorizonCircuitOpenError,
} = require("./horizonCircuitBreaker");

// ─── In-memory LRU cache for getAccount (5 s TTL) ────────────────────────────
const ACCOUNT_CACHE_TTL_MS = 5_000;
const ACCOUNT_CACHE_MAX = 256;

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
 * When the Horizon circuit is open, fail fast with retry guidance instead
 * of amplifying upstream load (#840).
 */
async function withTimeoutAndRetry(fn, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const breaker = getBreaker(HORIZON_URL);
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      breaker.assertCanExecute();
    } catch (circuitErr) {
      throw circuitErr;
    }

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
      breaker.recordSuccess();
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;

      if (!isTransientError(err)) {
        throw err;
      }

      breaker.recordFailure();
      if (breaker.state === STATES.OPEN) {
        throw new HorizonCircuitOpenError(breaker.snapshot());
      }

      if (attempt === MAX_RETRIES) {
        throw err;
      }

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

// ─── Account ──────────────────────────────────────────────────────────────────

/**
 * Load a Stellar account and return its balances.
 */
async function getAccount(publicKey) {
  validatePublicKey(publicKey);

  const breaker = getBreaker(HORIZON_URL);
  if (breaker.state === STATES.OPEN) {
    breaker.refreshState();
  }
  if (breaker.state !== STATES.OPEN) {
    const cached = cacheGet(publicKey);
    if (cached) return cached;
  }

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
      logger.error(
        { err: error, publicKey: publicKey.replace(/[\r\n]/g, "") },
        "Account not found"
      );
      throw error;
    }
    logger.error(
      { err, publicKey: publicKey.replace(/[\r\n]/g, "") },
      "Error loading account from Horizon"
    );
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
      logger.error(
        { err, transactionHash: op.transaction_hash },
        "Failed to fetch memo for transaction"
      );
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

// ─── Tip verification ──────────────────────────────────────────────────────────
//
// Callers report a tip (sender, creator, amount, asset, txHash) but that
// report is untrusted input. Before a tip is ever recorded we re-derive the
// truth from Horizon: load the transaction by hash, confirm it actually
// succeeded, confirm it's on the network this service is configured for, and
// confirm one of its payment operations actually matches what was claimed.

const TX_CACHE_TTL_MS = 10 * 60_000; // a confirmed on-chain tx is immutable — safe to cache well past request TTLs
const TX_CACHE_MAX = 1024;

/** @type {Map<string, { value: object, expiresAt: number }>} */
const txRecordCache = new Map();

function txCacheGet(key) {
  const entry = txRecordCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    txRecordCache.delete(key);
    return null;
  }
  txRecordCache.delete(key);
  txRecordCache.set(key, entry);
  return entry.value;
}

function txCacheSet(key, value) {
  if (txRecordCache.size >= TX_CACHE_MAX) {
    txRecordCache.delete(txRecordCache.keys().next().value);
  }
  txRecordCache.set(key, { value, expiresAt: Date.now() + TX_CACHE_TTL_MS });
}

function clearTransactionCache() {
  txRecordCache.clear();
}

const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;

function resolveNetworkName(passphrase) {
  if (!passphrase) return "unknown";
  if (passphrase.includes("Test SDF Network")) return "testnet";
  if (passphrase.includes("Public Global Stellar Network")) return "mainnet";
  return "custom";
}

const networkName = resolveNetworkName(networkPassphrase);

// A transaction hash is only ever resolvable against the Horizon instance
// that produced it, so a successful lookup already proves "same network" —
// *provided* `server` itself is actually pointed at the network this
// service believes it's on. This one-time check guards against that
// misconfiguration (e.g. a "testnet" deployment whose HORIZON_URL was
// accidentally set to mainnet). Memoized so it only runs once per process.
let networkAssertionPromise = null;

async function assertConfiguredNetwork() {
  if (networkAssertionPromise) return networkAssertionPromise;

  networkAssertionPromise = (async () => {
    const rootUrl = server?.serverURL?.toString?.();
    if (!rootUrl || typeof fetch !== "function") {
      // Can't introspect the Horizon root on this SDK/runtime — fall back to
      // trusting the configured passphrase without a live cross-check.
      return;
    }
    try {
      const res = await fetch(rootUrl);
      const root = await res.json();
      if (root?.network_passphrase && root.network_passphrase !== networkPassphrase) {
        const err = new Error(
          `Horizon server at ${rootUrl} is on network "${root.network_passphrase}" ` +
            `but this service is configured for "${networkPassphrase}" (${networkName}). ` +
            "Refusing to verify tips until this is fixed."
        );
        err.status = 500;
        throw err;
      }
    } catch (err) {
      if (err.status === 500) {
        networkAssertionPromise = null; // allow a retry once config is fixed
        throw err;
      }
      logger.error({ err }, "Could not confirm Horizon network passphrase at startup; continuing");
    }
  })();

  return networkAssertionPromise;
}

/**
 * Normalize a payment / path-payment operation for verification purposes.
 * Unlike `normalizePaymentOperation`, this doesn't need a "perspective"
 * public key — it just reports who actually paid whom, how much, in what
 * asset, straight from the ledger.
 */
function normalizePaymentForVerification(op) {
  const isPathPayment = op.type !== "payment";
  const assetCode = isPathPayment
    ? op.dest_asset_type === "native"
      ? "XLM"
      : op.dest_asset_code || "UNKNOWN"
    : op.asset_type === "native"
      ? "XLM"
      : op.asset_code || "UNKNOWN";
  const amount = isPathPayment ? op.dest_amount : op.amount;

  return {
    id: op.id,
    from: op.from,
    to: op.to,
    amount,
    asset: assetCode,
  };
}

function floatsEqual(a, b, epsilon = 1e-7) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < epsilon;
}

/**
 * Fetch a transaction and its payment operations from Horizon and normalize
 * them into an immutable record. Cached by hash — a confirmed transaction's
 * outcome never changes, so this is safe to reuse across requests.
 *
 * Only definitive results (found + successful, found + failed) are cached.
 * "Not found" is never cached, since a just-submitted, genuinely valid
 * transaction can briefly 404 on Horizon before ledger close propagates.
 */
async function getTransactionRecord(txHash) {
  const cached = txCacheGet(txHash);
  if (cached) return cached;

  await assertConfiguredNetwork();

  let tx;
  try {
    tx = await withTimeoutAndRetry(() => server.transactions().transaction(txHash).call());
  } catch (err) {
    if (err?.response?.status === 404) {
      const error = new Error("Transaction not found on this network");
      error.status = 404;
      throw error;
    }
    logger.error({ err, txHash }, "Error loading transaction from Horizon");
    throw err;
  }

  let paymentOps = [];
  if (tx.successful) {
    let opsPage;
    try {
      opsPage = await withTimeoutAndRetry(() => tx.operations());
    } catch (err) {
      logger.error({ err, txHash }, "Error loading operations for transaction");
      throw err;
    }
    paymentOps = opsPage.records
      .filter((op) => PAYMENT_TYPES.has(op.type))
      .map(normalizePaymentForVerification);
  }

  const record = {
    transactionHash: txHash,
    successful: tx.successful === true,
    ledger: tx.ledger_attr ?? tx.ledger,
    createdAt: tx.created_at,
    paymentOps,
  };

  txCacheSet(txHash, record);
  return record;
}

/**
 * Verify that a claimed tip actually happened on-chain: the transaction
 * exists, succeeded, is on this service's configured network, and contains
 * a payment operation matching the claimed sender, recipient, amount, and
 * asset.
 *
 * @param {string} txHash
 * @param {object} claim
 * @param {string} claim.senderPublicKey
 * @param {string} claim.creatorPublicKey
 * @param {string|number} claim.amount
 * @param {string} [claim.asset]
 * @returns {Promise<{transactionHash: string, ledger: number, createdAt: string, operationId: string, network: string}>}
 * @throws {Error} with `.status` set — 400 (bad input), 404 (tx not found),
 *   422 (tx failed or doesn't match the claim).
 */
async function verifyTipTransaction(txHash, { senderPublicKey, creatorPublicKey, amount, asset = "XLM" }) {
  if (!txHash || typeof txHash !== "string" || !TX_HASH_RE.test(txHash)) {
    const err = new Error("Invalid transaction hash format");
    err.status = 400;
    throw err;
  }

  validatePublicKey(senderPublicKey);
  validatePublicKey(creatorPublicKey);

  const claimedAmount = parseFloat(amount);
  if (!Number.isFinite(claimedAmount) || claimedAmount <= 0) {
    const err = new Error("amount must be a positive number");
    err.status = 400;
    throw err;
  }

  const record = await getTransactionRecord(txHash);

  if (!record.successful) {
    const err = new Error("Transaction failed on-chain and cannot be recorded as a tip");
    err.status = 422;
    throw err;
  }

  const match = record.paymentOps.find(
    (op) =>
      op.from === senderPublicKey &&
      op.to === creatorPublicKey &&
      op.asset === asset &&
      floatsEqual(parseFloat(op.amount), claimedAmount)
  );

  if (!match) {
    const err = new Error(
      "Transaction does not contain a matching payment for the given sender, recipient, amount, and asset"
    );
    err.status = 422;
    throw err;
  }

  return {
    transactionHash: record.transactionHash,
    ledger: record.ledger,
    createdAt: record.createdAt,
    operationId: match.id,
    network: networkName,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function normalizePaymentOperation(op, publicKey) {
  const isPathPayment = op.type !== "payment";
  const isSent = op.from === publicKey;

  let assetCode;
  if (isPathPayment && !isSent) {
    assetCode = op.dest_asset_type === "native" ? "XLM" : op.dest_asset_code || "UNKNOWN";
  } else {
    assetCode = op.asset_type === "native" ? "XLM" : op.asset_code || "UNKNOWN";
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
  verifyTipTransaction,
  validatePublicKey,
  clearAccountCache,
  clearTransactionCache,
};
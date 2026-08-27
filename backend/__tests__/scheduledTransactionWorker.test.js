/**
 * __tests__/scheduledTransactionWorker.test.js
 *
 * Unit tests for the scheduled-transaction worker.
 * The Horizon server and the stellar SDK are mocked so no real network calls
 * are made.  The in-memory store from scheduledTransactionService is used
 * directly so we can set up realistic queue states without monkey-patching.
 */

"use strict";

// ─── Mock stellar config before the worker requires it ───────────────────────
const mockSubmitTransaction = jest.fn();
jest.mock("../src/config/stellar", () => ({
  server: { submitTransaction: mockSubmitTransaction },
  HORIZON_URL: "https://horizon-testnet.stellar.org",
}));

// ─── Mock stellar-sdk TransactionBuilder.fromXDR ─────────────────────────────
const mockFromXDR = jest.fn();
jest.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: { fromXDR: mockFromXDR },
}));

// ─── Mock logger to suppress output in tests ─────────────────────────────────
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const {
  scheduleTransaction,
  getTransactionById,
  getDueTransactions,
  removeTransaction,
} = require("../src/services/scheduledTransactionService");

const { tick, processTransaction, start, stop } = require("../src/services/scheduledTransactionWorker");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_KEY = "GAQWTE4AWTBZYJYZIURRBYD6G4N6WMB4QNY2OXZFTKRYR6XQ4OQK6R37";
const VALID_XDR = "AAAAAgAAAAD_DUMMY_XDR_";

function scheduleDue(overrides = {}) {
  const tx = scheduleTransaction(VALID_XDR, new Date(Date.now() - 5000), VALID_KEY);
  Object.assign(tx, overrides); // allow caller to tweak fields directly
  return tx;
}

afterEach(() => {
  // Drain any transactions left in the store after each test
  const due = getDueTransactions();
  due.forEach((t) => removeTransaction(t.id));
  jest.clearAllMocks();
  stop(); // ensure the worker interval is cleared
});

// ─── processTransaction ───────────────────────────────────────────────────────

describe("processTransaction", () => {
  it("claims the transaction, submits it, and removes it from the queue on success", async () => {
    const fakeEnvelope = {};
    mockFromXDR.mockReturnValue(fakeEnvelope);
    mockSubmitTransaction.mockResolvedValue({ hash: "abc123" });

    const tx = scheduleDue();
    await processTransaction(tx);

    // Worker called fromXDR with the stored XDR
    expect(mockFromXDR).toHaveBeenCalledWith(VALID_XDR, "any");
    // Worker submitted via Horizon
    expect(mockSubmitTransaction).toHaveBeenCalledWith(fakeEnvelope);
    // Transaction is removed from the queue after success
    expect(getTransactionById(tx.id)).toBeNull();
  });

  it("records the error and releases the claim on submission failure (attempt 1)", async () => {
    mockFromXDR.mockReturnValue({});
    mockSubmitTransaction.mockRejectedValue(new Error("connection reset"));

    const tx = scheduleDue();
    await processTransaction(tx);

    const updated = getTransactionById(tx.id);
    expect(updated).not.toBeNull();
    expect(updated.attempts).toBe(1);
    expect(updated.lastError).toContain("connection reset");
    expect(updated.claimed).toBe(false); // released so retry is possible
    expect(updated.status).toBe("pending");
  });

  it("sets status to 'failed' once max attempts are exhausted", async () => {
    mockFromXDR.mockReturnValue({});
    mockSubmitTransaction.mockRejectedValue(new Error("timeout"));

    const tx = scheduleDue();

    // Simulate two prior failed attempts
    tx.attempts = 2;

    await processTransaction(tx);

    const updated = getTransactionById(tx.id);
    expect(updated.attempts).toBe(3);
    expect(updated.status).toBe("failed");
  });

  it("skips a transaction that another worker already claimed", async () => {
    const tx = scheduleDue();
    // Pre-claim it
    tx.claimed = true;

    await processTransaction(tx);

    // fromXDR should never be called
    expect(mockFromXDR).not.toHaveBeenCalled();
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });

  it("uses Horizon result codes in the error message when available", async () => {
    mockFromXDR.mockReturnValue({});
    const horizonError = new Error("Bad request");
    horizonError.response = {
      data: { extras: { result_codes: { transaction: "tx_bad_seq", operations: ["op_no_account"] } } },
    };
    mockSubmitTransaction.mockRejectedValue(horizonError);

    const tx = scheduleDue();
    await processTransaction(tx);

    const updated = getTransactionById(tx.id);
    expect(updated.lastError).toContain("tx_bad_seq");
    expect(updated.lastError).toContain("op_no_account");
  });
});

// ─── tick ─────────────────────────────────────────────────────────────────────

describe("tick", () => {
  it("processes all due transactions in a single tick", async () => {
    mockFromXDR.mockReturnValue({});
    mockSubmitTransaction
      .mockResolvedValueOnce({ hash: "hash-a" })
      .mockResolvedValueOnce({ hash: "hash-b" });

    const tx1 = scheduleDue();
    const tx2 = scheduleDue();

    await tick();

    // Both transactions should be gone (submitted successfully)
    expect(getTransactionById(tx1.id)).toBeNull();
    expect(getTransactionById(tx2.id)).toBeNull();
  });

  it("does not process future-scheduled transactions", async () => {
    const futureTx = scheduleTransaction(VALID_XDR, new Date(Date.now() + 60_000), VALID_KEY);

    await tick();

    // Future transaction should still be in the store
    expect(getTransactionById(futureTx.id)).not.toBeNull();
    expect(mockSubmitTransaction).not.toHaveBeenCalled();

    // Clean up
    removeTransaction(futureTx.id);
  });

  it("continues processing remaining transactions when one fails", async () => {
    mockFromXDR.mockReturnValue({});
    mockSubmitTransaction
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({ hash: "hash-ok" });

    const txFail = scheduleDue();
    const txOk = scheduleDue();

    await tick();

    // Failed one still present (attempt incremented)
    const updatedFail = getTransactionById(txFail.id);
    expect(updatedFail).not.toBeNull();
    expect(updatedFail.attempts).toBe(1);

    // Successful one removed
    expect(getTransactionById(txOk.id)).toBeNull();
  });

  it("is a no-op when the queue is empty", async () => {
    await expect(tick()).resolves.toBeUndefined();
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });
});

// ─── start / stop lifecycle ───────────────────────────────────────────────────

describe("worker lifecycle", () => {
  it("start() is idempotent and stop() clears the interval", () => {
    start();
    start(); // second call must not throw or double-register
    stop();
    stop(); // second stop must not throw
  });
});

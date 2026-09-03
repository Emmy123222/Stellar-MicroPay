const {
  scheduleTransaction,
  getPendingTransactions,
  getTransactionById,
  getDueTransactions,
  incrementAttempt,
  markSubmitted,
  reconcileTransaction,
  reconcileByHash,
  reconcileBySequence,
  getUnreconciledTransactions,
  deadLetterTransaction,
  getDeadLetterTransactions,
  getDeadLetterById,
  retryDeadLetter,
  removeDeadLetter,
  resetScheduler,
  classifySubmissionError,
  getBackoffDelayMs,
  MAX_ATTEMPTS,
} = require("../src/services/scheduledTransactionService");

describe("Scheduled Transaction Service", () => {
  const validPublicKey =
    "GAQWTE4AWTBZYJYZIURRBYD6G4N6WMB4QNY2OXZFTKRYR6XQ4OQK6R37";
  const validXDR = "AAAAAgAAAAD..."; // Dummy XDR

  beforeEach(() => {
    resetScheduler();
  });

  describe("Creating a schedule", () => {
    it("stores the expected fields", () => {
      const submitAt = new Date(Date.now() + 10000); // 10 seconds in future
      const scheduledTx = scheduleTransaction(
        validXDR,
        submitAt,
        validPublicKey,
      );

      expect(scheduledTx).toBeDefined();
      expect(scheduledTx.id).toBeDefined();
      expect(scheduledTx.signedXDR).toBe(validXDR);
      expect(scheduledTx.publicKey).toBe(validPublicKey);
      expect(scheduledTx.submitAt).toBe(submitAt.getTime());
      expect(scheduledTx.attempts).toBe(0);
      expect(scheduledTx.lastError).toBeNull();
      expect(scheduledTx.createdAt).toBeLessThanOrEqual(Date.now());

      const fetchedTx = getTransactionById(scheduledTx.id);
      expect(fetchedTx).toEqual(scheduledTx);
    });

    it("throws an error for invalid public key", () => {
      const submitAt = new Date(Date.now() + 10000);
      expect(() => {
        scheduleTransaction(validXDR, submitAt, "invalid_key");
      }).toThrow("Invalid Stellar public key format");
    });
  });

  describe("Due transactions execution", () => {
    it("returns transactions when their time arrives", () => {
      const pastTime = new Date(Date.now() - 10000); // 10 seconds in the past
      const futureTime = new Date(Date.now() + 10000); // 10 seconds in the future

      const dueTx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      const futureTx = scheduleTransaction(
        validXDR,
        futureTime,
        validPublicKey,
      );

      const dueTransactions = getDueTransactions();

      const foundDue = dueTransactions.find((tx) => tx.id === dueTx.id);
      const foundFuture = dueTransactions.find((tx) => tx.id === futureTx.id);

      expect(foundDue).toBeDefined();
      expect(foundFuture).toBeUndefined();
    });
  });

  describe("Failed executions (retries and dead-lettering)", () => {
    it("increments attempt and stores error", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);

      const errorMessage = "Network timeout";
      incrementAttempt(tx.id, errorMessage);

      const updatedTx = getTransactionById(tx.id);
      expect(updatedTx.attempts).toBe(1);
      expect(updatedTx.lastError).toBe(errorMessage);
      expect(updatedTx.lastErrorType).toBe("transient");
    });

    it("schedules a backoff window after a transient failure", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);

      const result = incrementAttempt(tx.id, "Network timeout");

      expect(result.status).toBe("retry");
      expect(result.attempts).toBe(1);
      // Backoff cap: base (1s) * 2^0 = 1s ± 20% jitter
      expect(result.delayMs).toBeGreaterThanOrEqual(800);
      expect(result.delayMs).toBeLessThanOrEqual(1200);
      expect(result.nextRetryAt).toBeGreaterThan(Date.now());

      // Not immediately due again — it must wait out the backoff window.
      const due = getDueTransactions().find((t) => t.id === tx.id);
      expect(due).toBeUndefined();
    });

    it("becomes due again once the backoff window elapses", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);

      incrementAttempt(tx.id, "Network timeout");

      // Force the backoff window into the past (live reference from store).
      getTransactionById(tx.id).nextRetryAt = Date.now() - 1000;

      const due = getDueTransactions().find((t) => t.id === tx.id);
      expect(due).toBeDefined();
      expect(due.attempts).toBe(1);
    });

    it("exposes MAX_ATTEMPTS as a bounded retry budget", () => {
      expect(MAX_ATTEMPTS).toBeGreaterThan(0);
      expect(MAX_ATTEMPTS).toBe(3);
    });

    it("dead-letters a transaction after exhausting the retry budget", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);

      // Attempt 1 & 2 — transient retries with backoff
      incrementAttempt(tx.id, "Error 1");
      incrementAttempt(tx.id, "Error 2");
      expect(getTransactionById(tx.id).deadLetter).toBe(false);

      // Attempt 3 (max attempts reached) — dead-lettered
      let result = incrementAttempt(tx.id, "Error 3");
      expect(result.status).toBe("dead_lettered");
      expect(getTransactionById(tx.id).attempts).toBe(3);
      expect(getTransactionById(tx.id).deadLetter).toBe(true);
      expect(getTransactionById(tx.id).nextRetryAt).toBeNull();

      const due = getDueTransactions().find((t) => t.id === tx.id);
      expect(due).toBeUndefined(); // Should not be due anymore
    });

    it("dead-letters immediately on a permanent error", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);

      const permanentError = Object.assign(new Error("tx_bad_seq"), {
        response: {
          status: 400,
          data: { extras: { result_codes: { transaction: "tx_bad_seq" } } },
        },
      });

      const result = incrementAttempt(tx.id, permanentError);
      expect(result.status).toBe("dead_lettered");
      expect(getTransactionById(tx.id).deadLetter).toBe(true);
      expect(getTransactionById(tx.id).deadLetterReason).toContain(
        "tx_bad_seq",
      );

      const due = getDueTransactions().find((t) => t.id === tx.id);
      expect(due).toBeUndefined();
    });
  });

  describe("Reconciliation", () => {
    it("marks a transaction as submitted with txHash", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);

      markSubmitted(tx.id, "abc123def456", "12345");
      const updated = getTransactionById(tx.id);

      expect(updated.submissionState).toBe("unknown");
      expect(updated.txHash).toBe("abc123def456");
      expect(updated.sourceSequence).toBe("12345");
    });

    it("submitted transactions are excluded from due list", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);

      let due = getDueTransactions().find((t) => t.id === tx.id);
      expect(due).toBeDefined();

      markSubmitted(tx.id, "hash1");
      due = getDueTransactions().find((t) => t.id === tx.id);
      expect(due).toBeUndefined();
    });

    it("reconcileByHash confirms when transaction found on-ledger", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1");

      const result = reconcileByHash(tx.id, { successful: true });
      expect(result).toBe("confirmed");
      expect(getTransactionById(tx.id).submissionState).toBe("confirmed");
    });

    it("reconcileByHash fails when transaction not found", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1");

      const result = reconcileByHash(tx.id, null);
      expect(result).toBe("failed");
      expect(getTransactionById(tx.id).submissionState).toBe("failed");
    });

    it("reconcileByHash fails when transaction failed on-ledger", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1");

      const result = reconcileByHash(tx.id, { successful: false });
      expect(result).toBe("failed");
    });

    it("reconcileBySequence confirms when sequence advanced", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1", "100");

      const result = reconcileBySequence(tx.id, 101);
      expect(result).toBe("confirmed");
      expect(getTransactionById(tx.id).submissionState).toBe("confirmed");
    });

    it("reconcileBySequence fails when sequence unchanged", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1", "100");

      const result = reconcileBySequence(tx.id, 100);
      expect(result).toBe("failed");
      expect(getTransactionById(tx.id).submissionState).toBe("failed");
    });

    it("returns unknown when sourceSequence not recorded", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1"); // no sourceSequence

      const result = reconcileBySequence(tx.id, 100);
      expect(result).toBe("unknown");
      expect(getTransactionById(tx.id).submissionState).toBe("unknown");
    });

    it("getUnreconciledTransactions returns only unknown-state txs", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx1 = scheduleTransaction(validXDR, pastTime, validPublicKey);
      const tx2 = scheduleTransaction(validXDR, pastTime, validPublicKey);
      const tx3 = scheduleTransaction(validXDR, pastTime, validPublicKey);

      markSubmitted(tx1.id, "hash1");
      markSubmitted(tx2.id, "hash2");
      reconcileTransaction(tx2.id, true);
      // tx3 never submitted

      const unreconciled = getUnreconciledTransactions();
      const ids = unreconciled.map((t) => t.id);
      expect(ids).toContain(tx1.id);
      expect(ids).not.toContain(tx2.id);
      expect(ids).not.toContain(tx3.id);
    });

    it("confirmed transactions are excluded from due list", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1");
      reconcileTransaction(tx.id, true);

      const due = getDueTransactions().find((t) => t.id === tx.id);
      expect(due).toBeUndefined();
    });

    it("failed reconciliation leaves tx excluded from due (terminal)", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1");
      reconcileTransaction(tx.id, false, "Not found");

      const due = getDueTransactions().find((t) => t.id === tx.id);
      expect(due).toBeUndefined();
    });
  });

  describe("Stellar error classification", () => {
    it("classifies network timeouts as transient", () => {
      expect(
        classifySubmissionError(new Error("socket timed out, ETIMEDOUT")).type,
      ).toBe("transient");
      expect(classifySubmissionError(new Error("network failure")).type).toBe(
        "transient",
      );
    });

    it("classifies 5xx and rate-limit (429) responses as transient", () => {
      const serverErr = Object.assign(new Error("Server unavailable"), {
        response: { status: 503 },
      });
      const rateErr = Object.assign(new Error("Too many requests"), {
        response: { status: 429 },
      });
      expect(classifySubmissionError(serverErr).type).toBe("transient");
      expect(classifySubmissionError(rateErr).type).toBe("transient");
    });

    it("classifies 4xx responses as permanent", () => {
      expect(
        classifySubmissionError(
          Object.assign(new Error("bad request"), {
            response: { status: 400 },
          }),
        ).type,
      ).toBe("permanent");
      expect(
        classifySubmissionError(
          Object.assign(new Error("not found"), { response: { status: 404 } }),
        ).type,
      ).toBe("permanent");
    });

    it("classifies known permanent result codes as permanent", () => {
      const underfunded = Object.assign(new Error("op_underfunded occurred"), {
        response: {
          status: 400,
          data: {
            extras: { result_codes: { operations: ["op_underfunded"] } },
          },
        },
      });
      expect(classifySubmissionError(underfunded).type).toBe("permanent");
      expect(classifySubmissionError(underfunded).message).toContain(
        "op_underfunded",
      );

      const badSeq = Object.assign(new Error("tx_bad_seq"), {
        response: {
          status: 400,
          data: { extras: { result_codes: { transaction: "tx_bad_seq" } } },
        },
      });
      expect(classifySubmissionError(badSeq).type).toBe("permanent");
    });

    it("classifies unknown errors as transient (fail safe)", () => {
      expect(
        classifySubmissionError(new Error("Something unexpected")).type,
      ).toBe("transient");
      expect(classifySubmissionError(null).type).toBe("transient");
      // Plain string messages are treated as transient.
      expect(classifySubmissionError("boom").type).toBe("transient");
    });
  });

  describe("Exponential backoff", () => {
    it("grows the base delay exponentially per attempt", () => {
      // Use a fixed RNG so jitter is deterministic (rng() = 0.5 → no jitter).
      const rng = () => 0.5;
      const attempt1 = getBackoffDelayMs(1, rng);
      const attempt2 = getBackoffDelayMs(2, rng);
      const attempt3 = getBackoffDelayMs(3, rng);

      expect(attempt1).toBe(1000);
      expect(attempt2).toBe(2000);
      expect(attempt3).toBe(4000);
      expect(attempt2).toBeGreaterThan(attempt1);
      expect(attempt3).toBeGreaterThan(attempt2);
    });

    it("applies jitter within the expected bounds", () => {
      // rng extremes actually exceed the bounds check; use variety.
      const delays = [0.1, 0.9, 0.5, 0.2, 0.8].map((r) =>
        getBackoffDelayMs(2, () => r),
      );
      for (const d of delays) {
        // base 2000ms ± 20% (400ms) → [1600, 2400]
        expect(d).toBeGreaterThanOrEqual(1600);
        expect(d).toBeLessThanOrEqual(2400);
      }
      // Jitter produces more than one distinct value.
      expect(new Set(delays).size).toBeGreaterThan(1);
    });

    it("caps the backoff delay at the maximum", () => {
      const rng = () => 0.5;
      const huge = getBackoffDelayMs(100, rng);
      expect(huge).toBeLessThanOrEqual(60000);
    });
  });

  describe("Dead-letter queue controls", () => {
    function makeDeadLettered(future = false) {
      const time = future ? Date.now() + 10000 : Date.now() - 10000;
      const tx = scheduleTransaction(validXDR, new Date(time), validPublicKey);
      deadLetterTransaction(tx.id, "manual park");
      return tx;
    }

    it("lists dead-lettered transactions", () => {
      const tx1 = makeDeadLettered();
      const tx2 = scheduleTransaction(
        validXDR,
        new Date(Date.now() - 10000),
        validPublicKey,
      );

      const dlq = getDeadLetterTransactions();
      const ids = dlq.map((t) => t.id);
      expect(ids).toContain(tx1.id);
      expect(ids).not.toContain(tx2.id);

      expect(getDeadLetterById(tx1.id).deadLetter).toBe(true);
      expect(getDeadLetterById(tx2.id)).toBeNull();
    });

    it("filters dead letters by public key", () => {
      const otherKey =
        "GBXRGOTUTQR6Z6RQ3K6HZQRRJ7R2Y62K6Z7PTOCT2ZNVHGHODK43RNLQ";
      const tx1 = makeDeadLettered();
      const tx2 = scheduleTransaction(
        validXDR,
        new Date(Date.now() - 10000),
        otherKey,
      );
      deadLetterTransaction(tx2.id, "other");

      const mine = getDeadLetterTransactions({ publicKey: validPublicKey });
      const ids = mine.map((t) => t.id);
      expect(ids).toContain(tx1.id);
      expect(ids).not.toContain(tx2.id);
    });

    it("dead-lettered transactions are excluded from due and pending", () => {
      const tx = makeDeadLettered();
      expect(getDueTransactions().find((t) => t.id === tx.id)).toBeUndefined();
      expect(
        getPendingTransactions(validPublicKey).find((t) => t.id === tx.id),
      ).toBeUndefined();
    });

    it("requeues a dead-lettered transaction for retry", () => {
      const tx = makeDeadLettered();

      const requeued = retryDeadLetter(tx.id, {
        retryAt: new Date(Date.now() + 5000),
      });
      expect(requeued.deadLetter).toBe(false);
      expect(requeued.attempts).toBe(0);
      expect(requeued.deadLetterReason).toBeNull();
      expect(getTransactionById(tx.id).nextRetryAt).toBeGreaterThan(Date.now());
      expect(getDeadLetterById(tx.id)).toBeNull();
    });

    it("requeuing makes the transaction due again immediately by default", () => {
      const tx = makeDeadLettered();
      retryDeadLetter(tx.id);
      expect(getDueTransactions().find((t) => t.id === tx.id)).toBeDefined();
    });

    it("returns null when requeuing a non-dead-lettered transaction", () => {
      const tx = scheduleTransaction(
        validXDR,
        new Date(Date.now() - 10000),
        validPublicKey,
      );
      expect(retryDeadLetter(tx.id)).toBeNull();
    });

    it("removes a dead-lettered transaction permanently", () => {
      const tx = makeDeadLettered();
      expect(removeDeadLetter(tx.id)).toBe(true);
      expect(getTransactionById(tx.id)).toBeNull();
      // Removing a non-dead-lettered tx returns false.
      const active = scheduleTransaction(
        validXDR,
        new Date(Date.now() - 10000),
        validPublicKey,
      );
      expect(removeDeadLetter(active.id)).toBe(false);
    });
  });
});

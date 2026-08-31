const {
  scheduleTransaction,
  getPendingTransactions,
  getTransactionById,
  cancelTransaction,
  getDueTransactions,
  incrementAttempt,
  removeTransaction,
  markSubmitted,
  reconcileTransaction,
  reconcileByHash,
  reconcileBySequence,
  getUnreconciledTransactions,
} = require("../src/services/scheduledTransactionService");

describe("Scheduled Transaction Service", () => {
  const validPublicKey = "GAQWTE4AWTBZYJYZIURRBYD6G4N6WMB4QNY2OXZFTKRYR6XQ4OQK6R37";
  const validXDR = "AAAAAgAAAAD..."; // Dummy XDR

  beforeEach(() => {
    // Clear the in-memory map before each test
    // We can do this by getting all pending and removing them
    // However, we don't have a direct clear method, so we'll cancel any we create
    // Or we can just let it persist and ensure we don't conflict.
  });

  afterEach(() => {
    // Attempt to clear by getting all due and pending and removing them
    const pending = getPendingTransactions(validPublicKey);
    pending.forEach(tx => removeTransaction(tx.id));
    
    // Some might be due but not pending for this user? getDueTransactions gets all
    const due = getDueTransactions();
    due.forEach(tx => removeTransaction(tx.id));
  });

  describe("Creating a schedule", () => {
    it("stores the expected fields", () => {
      const submitAt = new Date(Date.now() + 10000); // 10 seconds in future
      const scheduledTx = scheduleTransaction(validXDR, submitAt, validPublicKey);

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
      const futureTx = scheduleTransaction(validXDR, futureTime, validPublicKey);

      const dueTransactions = getDueTransactions();
      
      const foundDue = dueTransactions.find(tx => tx.id === dueTx.id);
      const foundFuture = dueTransactions.find(tx => tx.id === futureTx.id);

      expect(foundDue).toBeDefined();
      expect(foundFuture).toBeUndefined();
    });
  });

  describe("Failed executions (retries and marking failed)", () => {
    it("increments attempt and stores error", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);

      const errorMessage = "Network timeout";
      incrementAttempt(tx.id, errorMessage);

      const updatedTx = getTransactionById(tx.id);
      expect(updatedTx.attempts).toBe(1);
      expect(updatedTx.lastError).toBe(errorMessage);
    });

    it("stops returning transactions as due after 3 attempts", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);

      // Attempt 1
      incrementAttempt(tx.id, "Error 1");
      let due = getDueTransactions().find(t => t.id === tx.id);
      expect(due).toBeDefined();

      // Attempt 2
      incrementAttempt(tx.id, "Error 2");
      due = getDueTransactions().find(t => t.id === tx.id);
      expect(due).toBeDefined();

      // Attempt 3 (max attempts reached)
      incrementAttempt(tx.id, "Error 3");
      due = getDueTransactions().find(t => t.id === tx.id);
      expect(due).toBeUndefined(); // Should not be due anymore
      
      const updatedTx = getTransactionById(tx.id);
      expect(updatedTx.attempts).toBe(3);
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

      let due = getDueTransactions().find(t => t.id === tx.id);
      expect(due).toBeDefined();

      markSubmitted(tx.id, "hash1");
      due = getDueTransactions().find(t => t.id === tx.id);
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
      const ids = unreconciled.map(t => t.id);
      expect(ids).toContain(tx1.id);
      expect(ids).not.toContain(tx2.id);
      expect(ids).not.toContain(tx3.id);
    });

    it("confirmed transactions are excluded from due list", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1");
      reconcileTransaction(tx.id, true);

      const due = getDueTransactions().find(t => t.id === tx.id);
      expect(due).toBeUndefined();
    });

    it("failed reconciliation leaves tx excluded from due (terminal)", () => {
      const pastTime = new Date(Date.now() - 10000);
      const tx = scheduleTransaction(validXDR, pastTime, validPublicKey);
      markSubmitted(tx.id, "hash1");
      reconcileTransaction(tx.id, false, "Not found");

      const due = getDueTransactions().find(t => t.id === tx.id);
      expect(due).toBeUndefined();
    });
  });
});

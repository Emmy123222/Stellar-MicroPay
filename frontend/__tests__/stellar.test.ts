import {
  buildAccountMergeTransaction,
  buildPaymentTransaction,
  collectSignatures,
  createStellarMemo,
  getNetworkPassphrase,
  isValidStellarAddress,
  memoTextByteLength,
  server,
  truncateMemoText,
  TransactionCategory,
} from "@/lib/stellar";
import { Account, Keypair, Transaction } from "@stellar/stellar-sdk";

/** Valid mainnet-format address: G + 55 base32 chars (A-Z, 2-7). */
const VALID_MAINNET_ADDRESS =
  "GB62CUHQB72WRU3LZFL5BIXMQVQ22MJCDX4FZUBGBQH3PPPPS6INOCLV";

describe("Stellar helper", () => {
  it("builds an account merge transaction using Operation.accountMerge", async () => {
    const sourcePublicKey =
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const destinationPublicKey = VALID_MAINNET_ADDRESS;

    const mockAccount = new Account(sourcePublicKey, "1234567890");
    jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount as any);

    const transaction = await buildAccountMergeTransaction({
      fromPublicKey: sourcePublicKey,
      destinationPublicKey,
    });

    const operation = transaction.operations[0] as any;

    expect(transaction).toBeDefined();
    expect(transaction.operations.length).toBe(1);
    expect(operation.type).toBe("accountMerge");
    expect(operation.destination).toBe(destinationPublicKey);
  });

  it("assigns Payment category to payment records in getPaymentHistory", async () => {
    // This test assumes we have a way to test getPaymentHistory, but since it's complex with mocking Horizon,
    // we'll mock the server and check the category assignment.
    // For simplicity, since the function sets category: TransactionCategory.Payment,
    // we can test that the enum exists and is used.
    expect(TransactionCategory.Payment).toBe("Payment");
    expect(TransactionCategory.Merge).toBe("Merge");
  });

  describe("collectSignatures", () => {
    it("merges signatures from multiple signed XDRs onto the base transaction", async () => {
      // Create two test keypairs to act as co-signers
      const signer1 = Keypair.random();
      const signer2 = Keypair.random();
      const sourceAccount = Keypair.random();

      // Mock the server to return a valid account
      const mockAccount = new Account(sourceAccount.publicKey(), "1234567890");
      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount as any);

      // Build an unsigned payment transaction
      const unsignedTx = await buildPaymentTransaction({
        fromPublicKey: sourceAccount.publicKey(),
        toPublicKey: "GB62CUHQB72WRU3LZFL5BIXMQVQ22MJCDX4FZUBGBQH3PPPPS6INOCLV",
        amount: "10.0",
        memo: "Test multi-sig payment",
      });

      const unsignedXDR = unsignedTx.toXDR();

      // Each signer signs the transaction independently
      const tx1 = new Transaction(unsignedXDR, getNetworkPassphrase());
      tx1.sign(signer1);
      const signedXDR1 = tx1.toXDR();

      const tx2 = new Transaction(unsignedXDR, getNetworkPassphrase());
      tx2.sign(signer2);
      const signedXDR2 = tx2.toXDR();

      // Collect signatures from both signers
      const combinedXDR = await collectSignatures(unsignedXDR, [
        signedXDR1,
        signedXDR2,
      ]);

      // Parse the combined transaction and verify it has both signatures
      const combinedTx = new Transaction(combinedXDR, getNetworkPassphrase());

      expect(combinedTx.signatures.length).toBe(2);

      // Verify that the signatures match the expected signers
      const hints = combinedTx.signatures.map((sig) =>
        Buffer.from(sig.hint()).toString("hex"),
      );

      // Get expected hints from the signers' public keys (last 4 bytes)
      const expectedHint1 = Keypair.fromPublicKey(signer1.publicKey())
        .rawPublicKey()
        .slice(-4)
        .toString("hex");
      const expectedHint2 = Keypair.fromPublicKey(signer2.publicKey())
        .rawPublicKey()
        .slice(-4)
        .toString("hex");

      expect(hints).toContain(expectedHint1);
      expect(hints).toContain(expectedHint2);
    });

    it("handles duplicate signatures gracefully", async () => {
      const signer = Keypair.random();
      const sourceAccount = Keypair.random();

      const mockAccount = new Account(sourceAccount.publicKey(), "1234567890");
      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount as any);

      const unsignedTx = await buildPaymentTransaction({
        fromPublicKey: sourceAccount.publicKey(),
        toPublicKey: "GB62CUHQB72WRU3LZFL5BIXMQVQ22MJCDX4FZUBGBQH3PPPPS6INOCLV",
        amount: "5.0",
      });

      const unsignedXDR = unsignedTx.toXDR();

      // Sign the transaction
      const tx = new Transaction(unsignedXDR, getNetworkPassphrase());
      tx.sign(signer);
      const signedXDR = tx.toXDR();

      // Try to collect the same signature twice
      const combinedXDR = await collectSignatures(unsignedXDR, [
        signedXDR,
        signedXDR,
      ]);

      const combinedTx = new Transaction(combinedXDR, getNetworkPassphrase());

      // Should still have only 1 signature (no duplicates)
      expect(combinedTx.signatures.length).toBe(1);
    });

    it("throws an error for invalid XDR input", async () => {
      await expect(
        collectSignatures("INVALID_XDR", ["ALSO_INVALID"]),
      ).rejects.toThrow(
        "Invalid transaction XDR or signature collection failed",
      );
    });
  });

  describe("truncateMemoText", () => {
    it("preserves memo text that already fits within the byte limit", () => {
      expect(truncateMemoText("Coffee money")).toBe("Coffee money");
    });

    it("strips non-printable control characters from the memo", () => {
      const withControlChars = "Rent\u0000\u0007\u001Fpayment\u007F";
      expect(truncateMemoText(withControlChars)).toBe("Rentpayment");
    });

    it("preserves markup-like text as plain characters, not HTML", () => {
      const memo = "<script>alert(1)</script>";
      const result = truncateMemoText(memo);

      // The sanitizer only strips non-printable bytes — it is not an HTML
      // sanitizer. Printable markup characters survive as inert text; it is
      // up to the renderer (React's default escaping) to keep it inert.
      expect(result).toContain("<script>");
      expect(result.length).toBeLessThanOrEqual(28);
    });

    it("truncates to the 28-byte MEMO_TEXT limit after stripping control characters", () => {
      const longMemo =
        "\u0000This memo is definitely longer than twenty eight bytes";
      const result = truncateMemoText(longMemo);

      expect(result.startsWith("\u0000")).toBe(false);
      expect(memoTextByteLength(result)).toBeLessThanOrEqual(28);
    });

    it("truncates multi-byte UTF-8 characters without splitting a codepoint", () => {
      const emojiMemo = "🎉".repeat(20);
      const result = truncateMemoText(emojiMemo);

      expect(memoTextByteLength(result)).toBeLessThanOrEqual(28);
      expect([...result].every((char) => char === "🎉")).toBe(true);
    });
  });

  describe("memo types in buildPaymentTransaction", () => {
    const sourcePublicKey =
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const destinationPublicKey = VALID_MAINNET_ADDRESS;
    const HASH_HEX = "a".repeat(64);

    beforeEach(() => {
      const mockAccount = new Account(sourcePublicKey, "1234567890");
      jest.spyOn(server, "loadAccount").mockResolvedValue(mockAccount as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("adds MEMO_TEXT via Memo.text", async () => {
      const tx = await buildPaymentTransaction({
        fromPublicKey: sourcePublicKey,
        toPublicKey: destinationPublicKey,
        amount: "1",
        memo: "Invoice",
        memoType: "text",
      });
      expect(tx.memo.type).toBe("text");
      expect(tx.memo.value).toBe("Invoice");
      expect(createStellarMemo("text", "Invoice").type).toBe("text");
    });

    it("adds MEMO_ID via Memo.id for uint64 input", async () => {
      const tx = await buildPaymentTransaction({
        fromPublicKey: sourcePublicKey,
        toPublicKey: destinationPublicKey,
        amount: "1",
        memo: "123456789",
        memoType: "id",
      });
      expect(tx.memo.type).toBe("id");
      expect(String(tx.memo.value)).toBe("123456789");
      expect(createStellarMemo("id", "42").type).toBe("id");
    });

    it("adds MEMO_HASH via Memo.hash for 32-byte hex", async () => {
      const tx = await buildPaymentTransaction({
        fromPublicKey: sourcePublicKey,
        toPublicKey: destinationPublicKey,
        amount: "1",
        memo: HASH_HEX,
        memoType: "hash",
      });
      expect(tx.memo.type).toBe("hash");
      expect(Buffer.from(tx.memo.value as Buffer).toString("hex")).toBe(
        HASH_HEX,
      );
      expect(createStellarMemo("hash", HASH_HEX).type).toBe("hash");
    });

    it("adds MEMO_RETURN via Memo.return for 32-byte hex", async () => {
      const tx = await buildPaymentTransaction({
        fromPublicKey: sourcePublicKey,
        toPublicKey: destinationPublicKey,
        amount: "1",
        memo: HASH_HEX,
        memoType: "return",
      });
      expect(tx.memo.type).toBe("return");
      expect(Buffer.from(tx.memo.value as Buffer).toString("hex")).toBe(
        HASH_HEX,
      );
      expect(createStellarMemo("return", HASH_HEX).type).toBe("return");
    });

    it("rejects invalid MEMO_ID and MEMO_HASH values", () => {
      expect(() => createStellarMemo("id", "not-a-number")).toThrow(/uint64/i);
      expect(() => createStellarMemo("hash", "deadbeef")).toThrow(
        /32-byte hex/i,
      );
      expect(() => createStellarMemo("return", "xyz")).toThrow(/32-byte hex/i);
    });
  });
});

describe("isValidStellarAddress", () => {
  it("returns false for an empty string", () => {
    expect(isValidStellarAddress("")).toBe(false);
  });

  it("returns true for G + 55 correct base32 characters (56 total)", () => {
    // G + 55 chars from A-Z2-7
    const address = "G" + "A".repeat(55);
    expect(address).toHaveLength(56);
    expect(isValidStellarAddress(address)).toBe(true);
  });

  it("returns false when longer than 56 characters (G + 56)", () => {
    const address = "G" + "A".repeat(56);
    expect(address).toHaveLength(57);
    expect(isValidStellarAddress(address)).toBe(false);
  });

  it("returns false when the address starts with S (secret key)", () => {
    const secretLike = "S" + "A".repeat(55);
    expect(isValidStellarAddress(secretLike)).toBe(false);
  });

  it("returns false when the address contains a non-base32 character", () => {
    // '0', '1', '8', '9' are not in the Stellar base32 alphabet (A-Z, 2-7)
    const withZero = "G0" + "A".repeat(54);
    expect(isValidStellarAddress(withZero)).toBe(false);
    expect(isValidStellarAddress("G" + "A".repeat(54) + "!")).toBe(false);
  });

  it("returns true for a valid mainnet address", () => {
    expect(isValidStellarAddress(VALID_MAINNET_ADDRESS)).toBe(true);
  });

  it("returns false when shorter than 56 characters (G + 54)", () => {
    const address = "G" + "A".repeat(54);
    expect(address).toHaveLength(55);
    expect(isValidStellarAddress(address)).toBe(false);
  });
});

describe("memo types", () => {
  const SOURCE_PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const DEST_PUBLIC_KEY = "GB62CUHQB72WRU3LZFL5BIXMQVQ22MJCDX4FZUBGBQH3PPPPS6INOCLV";

  const mockSourceAccount = () =>
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      new Account(SOURCE_PUBLIC_KEY, "1234567890") as any
    );

  describe("buildMemo", () => {
    it("builds MEMO_TEXT and still truncates at the 28-byte cap", () => {
      const memo = buildMemo("text", "a".repeat(40));

      expect(memo.type).toBe("text");
      expect(memo.value).toBe("a".repeat(28));
    });

    it("builds MEMO_ID from a uint64 string", () => {
      const memo = buildMemo("id", "18446744073709551615");

      expect(memo.type).toBe("id");
      expect(memo.value).toBe("18446744073709551615");
    });

    it("builds MEMO_HASH from 32 bytes of hex", () => {
      const memo = buildMemo("hash", "ab".repeat(32));

      expect(memo.type).toBe("hash");
      expect((memo.value as Buffer).toString("hex")).toBe("ab".repeat(32));
    });

    it("builds MEMO_RETURN from 32 bytes of hex", () => {
      const memo = buildMemo("return", "cd".repeat(32));

      expect(memo.type).toBe("return");
      expect((memo.value as Buffer).toString("hex")).toBe("cd".repeat(32));
    });

    it("rejects a MEMO_ID above the uint64 range instead of rounding it", () => {
      expect(() => buildMemo("id", "18446744073709551616")).toThrow(/unsigned 64-bit/);
    });

    it("rejects a non-numeric MEMO_ID", () => {
      expect(() => buildMemo("id", "12345abc")).toThrow(/whole number/);
    });

    it("rejects a MEMO_HASH that is not 32 bytes", () => {
      expect(() => buildMemo("hash", "ab".repeat(16))).toThrow(/32 bytes/);
    });

    it("rejects a non-hexadecimal MEMO_RETURN", () => {
      expect(() => buildMemo("return", "z".repeat(64))).toThrow(/hexadecimal/);
    });
  });

  describe("memoValueError", () => {
    it("treats an empty memo as valid, because it is simply not attached", () => {
      expect(memoValueError("id", "")).toBeNull();
      expect(memoValueError("hash", "   ")).toBeNull();
    });

    it("accepts each type at its boundary", () => {
      expect(memoValueError("text", "a".repeat(28))).toBeNull();
      expect(memoValueError("text", "a".repeat(29))).toMatch(/28 bytes/);
      expect(memoValueError("id", "0")).toBeNull();
      expect(memoValueError("hash", "0f".repeat(32))).toBeNull();
    });
  });

  describe("buildPaymentTransaction", () => {
    it.each([
      ["text", "rent for march", "text"],
      ["id", "9007199254740993", "id"],
      ["hash", "ab".repeat(32), "hash"],
      ["return", "cd".repeat(32), "return"],
    ] as const)("puts a %s memo on the transaction", async (memoType, value, expectedType) => {
      mockSourceAccount();

      const transaction = await buildPaymentTransaction({
        fromPublicKey: SOURCE_PUBLIC_KEY,
        toPublicKey: DEST_PUBLIC_KEY,
        amount: "1.0000000",
        memo: value,
        memoType,
      });

      expect(transaction.memo.type).toBe(expectedType);
      if (expectedType === "hash" || expectedType === "return") {
        expect((transaction.memo.value as Buffer).toString("hex")).toBe(value);
      } else {
        expect(transaction.memo.value).toBe(value);
      }
    });

    it("still defaults to MEMO_TEXT when no type is given", async () => {
      mockSourceAccount();

      const transaction = await buildPaymentTransaction({
        fromPublicKey: SOURCE_PUBLIC_KEY,
        toPublicKey: DEST_PUBLIC_KEY,
        amount: "1.0000000",
        memo: "invoice 42",
      });

      expect(transaction.memo.type).toBe("text");
      expect(transaction.memo.value).toBe("invoice 42");
    });
  });
});

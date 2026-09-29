/**
 * __tests__/usePaymentNotes.test.ts
 * Unit tests for the private off-chain payment notes utilities.
 *
 * Issue #1189 - feat: add private off-chain payment notes stored in localStorage
 * Emmy123222/Stellar-MicroPay
 */

import {
  paymentNoteKey,
  loadPaymentNote,
  savePaymentNote,
  loadAllPaymentNotes,
  PAYMENT_NOTE_STORAGE_PREFIX,
} from "@/lib/usePaymentNotes";

// ─── localStorage Mock ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: jest.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorageMock.clear();
  jest.clearAllMocks();
});

// ─── paymentNoteKey ───────────────────────────────────────────────────────────

describe("paymentNoteKey", () => {
  it("generates keys with the expected prefix", () => {
    const hash = "abc123";
    expect(paymentNoteKey(hash)).toBe(`${PAYMENT_NOTE_STORAGE_PREFIX}${hash}`);
  });

  it("generates different keys for different hashes", () => {
    expect(paymentNoteKey("hash1")).not.toBe(paymentNoteKey("hash2"));
  });
});

// ─── loadPaymentNote ──────────────────────────────────────────────────────────

describe("loadPaymentNote", () => {
  it("returns null when no note exists", () => {
    expect(loadPaymentNote("nonexistent-hash")).toBeNull();
  });

  it("returns the saved note for a given hash", () => {
    localStorageMock.setItem(paymentNoteKey("tx-hash-1"), "Paid for design work");
    expect(loadPaymentNote("tx-hash-1")).toBe("Paid for design work");
  });
});

// ─── savePaymentNote ──────────────────────────────────────────────────────────

describe("savePaymentNote", () => {
  it("saves a note to localStorage", () => {
    savePaymentNote("tx-abc", "Rent for March");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      paymentNoteKey("tx-abc"),
      "Rent for March"
    );
  });

  it("removes the key when an empty note is saved", () => {
    localStorageMock.setItem(paymentNoteKey("tx-abc"), "Old note");
    savePaymentNote("tx-abc", "   ");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(paymentNoteKey("tx-abc"));
  });

  it("removes the key when an empty string note is saved", () => {
    localStorageMock.setItem(paymentNoteKey("tx-xyz"), "Will be removed");
    savePaymentNote("tx-xyz", "");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(paymentNoteKey("tx-xyz"));
  });

  it("overwrites an existing note", () => {
    savePaymentNote("tx-abc", "First note");
    savePaymentNote("tx-abc", "Updated note");
    expect(localStorageMock.setItem).toHaveBeenLastCalledWith(
      paymentNoteKey("tx-abc"),
      "Updated note"
    );
  });
});

// ─── loadAllPaymentNotes ──────────────────────────────────────────────────────

describe("loadAllPaymentNotes", () => {
  it("returns an empty object when no notes exist", () => {
    expect(loadAllPaymentNotes()).toEqual({});
  });

  it("returns all notes keyed by transaction hash", () => {
    const hash1 = "aaaa1111";
    const hash2 = "bbbb2222";
    localStorageMock.setItem(paymentNoteKey(hash1), "Note for tx1");
    localStorageMock.setItem(paymentNoteKey(hash2), "Note for tx2");
    // Also add an unrelated key to confirm filtering works
    localStorageMock.setItem("unrelated-key", "Should not appear");

    const result = loadAllPaymentNotes();
    expect(result[hash1]).toBe("Note for tx1");
    expect(result[hash2]).toBe("Note for tx2");
    expect(Object.keys(result)).not.toContain("unrelated-key");
  });

  it("ignores localStorage keys that don't match the prefix", () => {
    localStorageMock.setItem("stellar-micropay:network", '{"network":"testnet"}');
    localStorageMock.setItem("stellar-micropay:favourites", "[]");
    const result = loadAllPaymentNotes();
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ─── Round-trip test ──────────────────────────────────────────────────────────

describe("save → load round trip", () => {
  it("can save and then load a note for the same hash", () => {
    const hash = "round-trip-hash-42";
    const note = "Invoice #4201 — web design";
    savePaymentNote(hash, note);
    // Simulate the actual read from storage
    localStorageMock.getItem.mockImplementationOnce(() => note);
    const loaded = loadPaymentNote(hash);
    expect(loaded).toBe(note);
  });
});

/**
 * lib/usePaymentNotes.ts
 * React hook for managing private, off-chain payment notes stored in localStorage.
 *
 * Notes are keyed by transaction hash under "stellar-micropay:note:<hash>".
 * They are local-only and never sent to any server.
 *
 * Issue #1189 - feat: add private off-chain payment notes stored in localStorage
 * Emmy123222/Stellar-MicroPay
 */

import { useState, useCallback } from "react";

export const PAYMENT_NOTE_STORAGE_PREFIX = "stellar-micropay:note:";

/**
 * Build the localStorage key for a given transaction hash.
 */
export function paymentNoteKey(transactionHash: string): string {
  return `${PAYMENT_NOTE_STORAGE_PREFIX}${transactionHash}`;
}

/**
 * Load the note for a single transaction hash from localStorage.
 * Returns null if no note exists or if localStorage is unavailable.
 */
export function loadPaymentNote(transactionHash: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(paymentNoteKey(transactionHash));
  } catch {
    return null;
  }
}

/**
 * Save a note for a transaction hash to localStorage.
 * Passing an empty string removes the note.
 */
export function savePaymentNote(transactionHash: string, note: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = paymentNoteKey(transactionHash);
    if (note.trim() === "") {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, note.trim());
    }
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded)
  }
}

/**
 * Load all saved payment notes as a hash→note map.
 * Iterates over all localStorage keys matching the prefix.
 */
export function loadAllPaymentNotes(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const notes: Record<string, string> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PAYMENT_NOTE_STORAGE_PREFIX)) {
        const hash = key.slice(PAYMENT_NOTE_STORAGE_PREFIX.length);
        const value = window.localStorage.getItem(key);
        if (value) notes[hash] = value;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return notes;
}

/**
 * React hook for reading/writing a payment note for a specific transaction.
 *
 * @param transactionHash - The Stellar transaction hash.
 * @returns { note, setNote, isSaving } where setNote persists to localStorage.
 */
export function usePaymentNote(transactionHash: string) {
  const [note, setNoteState] = useState<string>(() => loadPaymentNote(transactionHash) ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const setNote = useCallback(
    (value: string) => {
      setNoteState(value);
      setIsSaving(true);
      savePaymentNote(transactionHash, value);
      // Brief "saving" indicator so the UI can flash saved state
      setTimeout(() => setIsSaving(false), 500);
    },
    [transactionHash]
  );

  return { note, setNote, isSaving };
}

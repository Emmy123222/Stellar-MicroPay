/**
 * lib/contacts.ts
 * Shared contacts storage helpers.
 *
 * The Contacts page (pages/contacts.tsx) persists contacts in localStorage
 * under the `stellar-micropay-contacts` key. This module exposes the same
 * shape/key so other surfaces (e.g. the address-book picker in
 * SendPaymentForm) can read contacts without duplicating the schema.
 */

export interface Contact {
  id: string;
  name: string;
  address: string;
  createdAt: number;
}

export const CONTACTS_STORAGE_KEY = "stellar-micropay-contacts";

/** Reads all saved contacts; returns [] when nothing/invalid is stored. */
export function loadContacts(): Contact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Contact =>
        c &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.address === "string"
    );
  } catch {
    return [];
  }
}

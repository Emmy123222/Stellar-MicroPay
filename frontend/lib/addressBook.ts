import { isValidStellarAddress } from "./stellar";

export interface AddressBookContact {
  id: string;
  nickname: string;
  address: string;
  createdAt: number;
  updatedAt: number;
  /** Whether this contact is starred / pinned to the top */
  favourite?: boolean;
  /** User-defined string tags for categorisation */
  tags?: string[];
}

const ADDRESS_BOOK_STORAGE_KEY = "stellar-micropay:contacts";
const LEGACY_CONTACTS_STORAGE_KEY = "stellar-micropay-contacts";
const LEGACY_FAVOURITES_STORAGE_KEY = "stellar-micropay:favourites";
const CONTACTS_UPDATED_EVENT = "stellar-micropay:contacts-updated";

interface LegacyContact {
  id?: string;
  name?: string;
  nickname?: string;
  address?: string;
  createdAt?: number;
  updatedAt?: number;
  favourite?: boolean;
  tags?: string[];
}

function now() {
  return Date.now();
}

function makeContact(input: LegacyContact): AddressBookContact | null {
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const nicknameSource =
    typeof input.nickname === "string"
      ? input.nickname
      : typeof input.name === "string"
        ? input.name
        : "";
  const nickname = nicknameSource.trim();

  if (!address || !nickname || !isValidStellarAddress(address)) return null;

  const tags: string[] = Array.isArray(input.tags)
    ? input.tags
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim())
    : [];

  return {
    id: input.id || `${address}:${input.createdAt || now()}`,
    nickname,
    address,
    createdAt: typeof input.createdAt === "number" ? input.createdAt : now(),
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : now(),
    favourite: input.favourite === true,
    tags,
  };
}

function readContactsFromKey(key: string): AddressBookContact[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyContact[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(makeContact)
      .filter((contact): contact is AddressBookContact => Boolean(contact));
  } catch {
    return [];
  }
}

function dedupeContacts(contacts: AddressBookContact[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    if (seen.has(contact.address)) return false;
    seen.add(contact.address);
    return true;
  });
}

/** Load and merge all stored contacts (current and legacy storage keys), deduplicated by address. */
export function loadAddressBookContacts(): AddressBookContact[] {
  const primaryContacts = readContactsFromKey(ADDRESS_BOOK_STORAGE_KEY);
  const legacyContacts = readContactsFromKey(LEGACY_CONTACTS_STORAGE_KEY);
  const legacyFavourites = readContactsFromKey(LEGACY_FAVOURITES_STORAGE_KEY);
  return dedupeContacts([...primaryContacts, ...legacyContacts, ...legacyFavourites]);
}

/** Persist the given contacts to local storage and notify listeners via a custom event. */
export function saveAddressBookContacts(contacts: AddressBookContact[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADDRESS_BOOK_STORAGE_KEY, JSON.stringify(contacts));
    window.dispatchEvent(new CustomEvent(CONTACTS_UPDATED_EVENT, { detail: contacts }));
  } catch {
    // Ignore storage failures (private browsing, full quota, etc.).
  }
}

/** Create a new contact or update an existing one matched by address, then persist and return the full contacts list. */
export function upsertAddressBookContact(input: {
  nickname: string;
  address: string;
  favourite?: boolean;
  tags?: string[];
}) {
  const nickname = input.nickname.trim();
  const address = input.address.trim();

  if (!nickname) throw new Error("Enter a nickname for this contact.");
  if (!isValidStellarAddress(address)) throw new Error("Enter a valid Stellar public key.");

  const contacts = loadAddressBookContacts();
  const existingIndex = contacts.findIndex((contact) => contact.address === address);
  const timestamp = now();

  const normalisedTags = Array.isArray(input.tags)
    ? Array.from(new Set(input.tags.map((t) => t.trim()).filter(Boolean)))
    : undefined;

  if (existingIndex >= 0) {
    contacts[existingIndex] = {
      ...contacts[existingIndex],
      nickname,
      updatedAt: timestamp,
      ...(input.favourite !== undefined ? { favourite: input.favourite } : {}),
      ...(normalisedTags !== undefined ? { tags: normalisedTags } : {}),
    };
  } else {
    contacts.unshift({
      id: `${address}:${timestamp}`,
      nickname,
      address,
      createdAt: timestamp,
      updatedAt: timestamp,
      favourite: input.favourite ?? false,
      tags: normalisedTags ?? [],
    });
  }

  saveAddressBookContacts(contacts);
  return contacts;
}

/** Remove a contact by id, persist the change, and return the updated contacts list. */
export function deleteAddressBookContact(id: string) {
  const contacts = loadAddressBookContacts().filter((contact) => contact.id !== id);
  saveAddressBookContacts(contacts);
  return contacts;
}

/**
 * Toggle the favourite flag for a single contact.
 * Returns the updated contacts array.
 */
export function toggleFavouriteContact(id: string): AddressBookContact[] {
  const contacts = loadAddressBookContacts().map((contact) =>
    contact.id === id ? { ...contact, favourite: !contact.favourite, updatedAt: now() } : contact
  );
  saveAddressBookContacts(contacts);
  return contacts;
}

/**
 * Update the tags for a single contact.
 * Returns the updated contacts array.
 */
export function updateContactTags(id: string, tags: string[]): AddressBookContact[] {
  const normalisedTags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  const contacts = loadAddressBookContacts().map((contact) =>
    contact.id === id ? { ...contact, tags: normalisedTags, updatedAt: now() } : contact
  );
  saveAddressBookContacts(contacts);
  return contacts;
}

/**
 * Collect all unique tags used across all contacts.
 */
export function getAllTags(contacts: AddressBookContact[]): string[] {
  const tagSet = new Set<string>();
  for (const c of contacts) {
    for (const t of c.tags ?? []) {
      tagSet.add(t);
    }
  }
  return Array.from(tagSet).sort();
}

/** Subscribe to contact list changes (same-tab custom events and cross-tab storage events), returning an unsubscribe function. */
export function subscribeToAddressBookContacts(callback: (contacts: AddressBookContact[]) => void) {
  if (typeof window === "undefined") return () => undefined;

  const onContactsUpdated = () => callback(loadAddressBookContacts());
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === ADDRESS_BOOK_STORAGE_KEY ||
      event.key === LEGACY_CONTACTS_STORAGE_KEY ||
      event.key === LEGACY_FAVOURITES_STORAGE_KEY
    ) {
      callback(loadAddressBookContacts());
    }
  };

  window.addEventListener(CONTACTS_UPDATED_EVENT, onContactsUpdated);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(CONTACTS_UPDATED_EVENT, onContactsUpdated);
    window.removeEventListener("storage", onStorage);
  };
}

/** Returns the local storage key used for the primary address book contacts. */
export function getAddressBookStorageKey() {
  return ADDRESS_BOOK_STORAGE_KEY;
}

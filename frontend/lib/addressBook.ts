import { isValidStellarAddress } from "@/lib/stellar";

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

function getActiveNetworkName(): string {
  if (typeof window === "undefined") return "testnet";

  try {
    const stored = window.localStorage.getItem("stellar-micropay:network");
    if (!stored) return "testnet";
    const parsed = JSON.parse(stored) as { network?: string };
    return parsed?.network === "mainnet" ? "mainnet" : "testnet";
  } catch {
    return "testnet";
  }
}

function getActivePublicKey(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem("stellar-micropay:last-public-key");
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function getScopedKeyForContext(
  publicKey: string | null = getActivePublicKey(),
  networkName: string = getActiveNetworkName(),
): string {
  const key = (publicKey ?? "anonymous").trim() || "anonymous";
  return `${ADDRESS_BOOK_STORAGE_KEY}:${networkName}:${key}`;
}

function migrateLegacyAddressBookRecords(): AddressBookContact[] {
  if (typeof window === "undefined") return [];

  const scopedKey = getScopedKeyForContext();
  const current = readContactsFromKey(scopedKey);
  if (current.length > 0) return current;

  const migrated = dedupeContacts([
    ...readContactsFromKey(ADDRESS_BOOK_STORAGE_KEY),
    ...readContactsFromKey(LEGACY_CONTACTS_STORAGE_KEY),
    ...readContactsFromKey(LEGACY_FAVOURITES_STORAGE_KEY),
  ]);

  if (migrated.length > 0) {
    try {
      window.localStorage.setItem(scopedKey, JSON.stringify(migrated));
      window.localStorage.removeItem(ADDRESS_BOOK_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_CONTACTS_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_FAVOURITES_STORAGE_KEY);
    } catch {
      // Ignore storage failures (private browsing, full quota, etc.).
    }
  }

  return migrated;
}

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
    typeof input.nickname === "string" ? input.nickname : typeof input.name === "string" ? input.name : "";
  const nickname = nicknameSource.trim();

  if (!address || !nickname || !isValidStellarAddress(address)) return null;

  const tags: string[] = Array.isArray(input.tags)
    ? input.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
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
    return dedupeContacts(
      parsed.map(makeContact).filter((contact): contact is AddressBookContact => Boolean(contact))
    );
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

/** Load the address book for the currently active wallet/network, migrating any legacy unscoped data once. */
export function loadAddressBookContacts(): AddressBookContact[] {
  const scopedKey = getScopedKeyForContext();
  const scopedContacts = readContactsFromKey(scopedKey);
  if (scopedContacts.length > 0) return scopedContacts;

  const migrated = migrateLegacyAddressBookRecords();
  return dedupeContacts(migrated.length > 0 ? migrated : scopedContacts);
}

/** Persist the given contacts to local storage and notify listeners via a custom event. */
export function saveAddressBookContacts(contacts: AddressBookContact[]) {
  if (typeof window === "undefined") return;

  try {
    const scopedKey = getScopedKeyForContext();
    const dedupedContacts = dedupeContacts(contacts);
    window.localStorage.setItem(scopedKey, JSON.stringify(dedupedContacts));
    window.dispatchEvent(new CustomEvent(CONTACTS_UPDATED_EVENT, { detail: dedupedContacts }));
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
      event.key === LEGACY_FAVOURITES_STORAGE_KEY ||
      event.key === getScopedKeyForContext()
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

/** Returns the local storage key used for the active account/network. */
export function getAddressBookStorageKey(
  publicKey: string | null = getActivePublicKey(),
  networkName: string = getActiveNetworkName(),
) {
  return getScopedKeyForContext(publicKey, networkName);
}

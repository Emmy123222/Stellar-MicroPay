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
const QUARANTINE_STORAGE_KEY = "stellar-micropay:contacts-quarantine";

/** Current storage schema version. Bump when the envelope shape changes. */
const SCHEMA_VERSION = 2;

interface VersionedEnvelope {
  version: number;
  contacts: LegacyContact[];
}

/** Quarantined entry: a record that failed validation during load. */
export interface QuarantinedContact {
  raw: unknown;
  reason: string;
  quarantinedAt: number;
}

/** Load quarantine log from storage. */
function readQuarantine(): QuarantinedContact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUARANTINE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQuarantine(entries: QuarantinedContact[]) {
  if (typeof window === "undefined") return;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(QUARANTINE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(QUARANTINE_STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {
    // ignore storage errors
  }
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

function readContactsFromKey(
  key: string,
  quarantineSink?: QuarantinedContact[],
): AddressBookContact[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);

    // Accept versioned envelope { version, contacts } or legacy bare array.
    let contacts: LegacyContact[];
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "version" in parsed &&
      Array.isArray((parsed as VersionedEnvelope).contacts)
    ) {
      contacts = (parsed as VersionedEnvelope).contacts;
    } else if (Array.isArray(parsed)) {
      contacts = parsed;
    } else {
      return [];
    }

    return contacts
      .map((rawContact, index) => {
        const contact = makeContact(rawContact);
        if (!contact && quarantineSink) {
          quarantineSink.push({
            raw: rawContact,
            reason: "Failed validation: missing address, nickname, or invalid Stellar key",
            quarantinedAt: now(),
          });
        }
        return contact;
      })
      .filter((c): c is AddressBookContact => c !== null);
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
  const quarantine: QuarantinedContact[] = [];
  const primaryContacts = readContactsFromKey(ADDRESS_BOOK_STORAGE_KEY, quarantine);
  const legacyContacts = readContactsFromKey(LEGACY_CONTACTS_STORAGE_KEY, quarantine);
  const legacyFavourites = readContactsFromKey(LEGACY_FAVOURITES_STORAGE_KEY, quarantine);

  // Persist quarantined entries so the UI can surface a recoverable warning.
  if (quarantine.length > 0) {
    const existing = readQuarantine();
    const merged = [...existing, ...quarantine];
    // Cap at 100 entries to prevent unbounded growth.
    writeQuarantine(merged.slice(-100));
  }

  return dedupeContacts([...primaryContacts, ...legacyContacts, ...legacyFavourites]);
}

/**
 * Return quarantined contacts from the last load(s).
 * The UI should display a recoverable warning when this list is non-empty.
 */
export function getQuarantinedContacts(): QuarantinedContact[] {
  return readQuarantine();
}

/**
 * Dismiss quarantined entries (user acknowledged the warning).
 */
export function clearQuarantinedContacts() {
  writeQuarantine([]);
}

/**
 * Attempt to restore a quarantined entry by re-validating it.
 * If it passes validation, it is added to the address book and removed
 * from quarantine. Returns true on success.
 */
export function restoreQuarantinedContact(entry: QuarantinedContact): boolean {
  const contact = makeContact(entry.raw as LegacyContact);
  if (!contact) return false;

  const contacts = loadAddressBookContacts();
  const exists = contacts.some((c) => c.address === contact.address);
  if (!exists) {
    contacts.unshift(contact);
    saveAddressBookContacts(contacts);
  }

  // Remove this entry from quarantine
  const remaining = readQuarantine().filter((q) => q !== entry);
  writeQuarantine(remaining);
  return true;
}

/** Persist the given contacts to local storage with a versioned envelope, and notify listeners via a custom event. */
export function saveAddressBookContacts(contacts: AddressBookContact[]) {
  if (typeof window === "undefined") return;

  try {
    const envelope: VersionedEnvelope = { version: SCHEMA_VERSION, contacts };
    window.localStorage.setItem(ADDRESS_BOOK_STORAGE_KEY, JSON.stringify(envelope));
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

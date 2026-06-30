import { isValidStellarAddress } from "@/lib/stellar";

export interface AddressBookContact {
  id: string;
  nickname: string;
  address: string;
  createdAt: number;
  updatedAt: number;
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

  return {
    id: input.id || `${address}:${input.createdAt || now()}`,
    nickname,
    address,
    createdAt: typeof input.createdAt === "number" ? input.createdAt : now(),
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : now(),
  };
}

function readContactsFromKey(key: string): AddressBookContact[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyContact[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(makeContact).filter((contact): contact is AddressBookContact => Boolean(contact));
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

export function loadAddressBookContacts(): AddressBookContact[] {
  const primaryContacts = readContactsFromKey(ADDRESS_BOOK_STORAGE_KEY);
  const legacyContacts = readContactsFromKey(LEGACY_CONTACTS_STORAGE_KEY);
  const legacyFavourites = readContactsFromKey(LEGACY_FAVOURITES_STORAGE_KEY);
  return dedupeContacts([...primaryContacts, ...legacyContacts, ...legacyFavourites]);
}

export function saveAddressBookContacts(contacts: AddressBookContact[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADDRESS_BOOK_STORAGE_KEY, JSON.stringify(contacts));
    window.dispatchEvent(new CustomEvent(CONTACTS_UPDATED_EVENT, { detail: contacts }));
  } catch {
    // Ignore storage failures (private browsing, full quota, etc.).
  }
}

export function upsertAddressBookContact(input: { nickname: string; address: string }) {
  const nickname = input.nickname.trim();
  const address = input.address.trim();

  if (!nickname) throw new Error("Enter a nickname for this contact.");
  if (!isValidStellarAddress(address)) throw new Error("Enter a valid Stellar public key.");

  const contacts = loadAddressBookContacts();
  const existingIndex = contacts.findIndex((contact) => contact.address === address);
  const timestamp = now();

  if (existingIndex >= 0) {
    contacts[existingIndex] = {
      ...contacts[existingIndex],
      nickname,
      updatedAt: timestamp,
    };
  } else {
    contacts.unshift({
      id: `${address}:${timestamp}`,
      nickname,
      address,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  saveAddressBookContacts(contacts);
  return contacts;
}

export function deleteAddressBookContact(id: string) {
  const contacts = loadAddressBookContacts().filter((contact) => contact.id !== id);
  saveAddressBookContacts(contacts);
  return contacts;
}

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

export function getAddressBookStorageKey() {
  return ADDRESS_BOOK_STORAGE_KEY;
}

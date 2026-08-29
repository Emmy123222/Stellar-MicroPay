/**
 * __tests__/addressBook.test.ts
 * Unit tests for addressBook.ts (#517)
 */

import {
  loadAddressBookContacts,
  saveAddressBookContacts,
  upsertAddressBookContact,
  deleteAddressBookContact,
  toggleFavouriteContact,
  updateContactTags,
  getAllTags,
  getAddressBookStorageKey,
  type AddressBookContact,
} from '../lib/addressBook';

const VALID_ADDRESS_A = 'G' + 'A'.repeat(55);
const VALID_ADDRESS_B = 'G' + 'B'.repeat(55);
const VALID_ADDRESS_C = 'G' + 'C'.repeat(55);
const VALID_ADDRESS_D = 'G' + 'D'.repeat(55);
const VALID_ADDRESS_E = 'G' + 'E'.repeat(55);
const VALID_ADDRESS_F = 'G' + 'F'.repeat(55);
const VALID_ADDRESS_G = 'G' + 'G'.repeat(55);
const VALID_ADDRESS_H = 'G' + 'H'.repeat(55);
const VALID_ADDRESS_I = 'G' + 'I'.repeat(55);
const VALID_ADDRESS_J = 'G' + 'J'.repeat(55);

// Mock isValidStellarAddress
jest.mock('../lib/stellar', () => ({
  isValidStellarAddress: (address: string) => {
    return typeof address === 'string' && address.startsWith('G') && address.length === 56;
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock window.dispatchEvent
const mockDispatchEvent = jest.fn();
window.dispatchEvent = mockDispatchEvent;

describe('addressBook', () => {
  beforeEach(() => {
    localStorageMock.clear();
    mockDispatchEvent.mockClear();
  });

  describe('Add contact persists to storage and appears in list()', () => {
    it('adds a new contact to storage', () => {
      const contact = {
        nickname: 'Alice',
        address: VALID_ADDRESS_A,
      };

      upsertAddressBookContact(contact);

      const contacts = loadAddressBookContacts();
      expect(contacts).toHaveLength(1);
      expect(contacts[0].nickname).toBe('Alice');
      expect(contacts[0].address).toBe(contact.address);
    });

    it('persists contact to localStorage', () => {
      const contact = {
        nickname: 'Bob',
        address: VALID_ADDRESS_B,
      };

      upsertAddressBookContact(contact);

      const storageKey = getAddressBookStorageKey();
      const rawData = localStorage.getItem(storageKey);
      expect(rawData).not.toBeNull();

      const parsedData = JSON.parse(rawData!);
      expect(Array.isArray(parsedData)).toBe(true);
      expect(parsedData[0].nickname).toBe('Bob');
    });

    it('new contact appears in list() immediately', () => {
      upsertAddressBookContact({
        nickname: 'Charlie',
        address: VALID_ADDRESS_C,
      });

      const contacts = loadAddressBookContacts();
      expect(contacts.some(c => c.nickname === 'Charlie')).toBe(true);
    });

    it('adds contact with optional fields', () => {
      upsertAddressBookContact({
        nickname: 'David',
        address: VALID_ADDRESS_D,
        favourite: true,
        tags: ['friend', 'work'],
      });

      const contacts = loadAddressBookContacts();
      const david = contacts.find(c => c.nickname === 'David');
      
      expect(david).toBeDefined();
      expect(david?.favourite).toBe(true);
      expect(david?.tags).toEqual(['friend', 'work']);
    });

    it('dispatches custom event when contact is added', () => {
      upsertAddressBookContact({
        nickname: 'Eve',
        address: VALID_ADDRESS_E,
      });

      expect(mockDispatchEvent).toHaveBeenCalled();
      const event = mockDispatchEvent.mock.calls[0][0];
      expect(event.type).toBe('stellar-micropay:contacts-updated');
    });

    it('scopes contacts by active wallet and network', () => {
      const alice = 'GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV';
      const bob = 'GCFVV3BKTNNXJ46CY2TLAGRYFSP23HKEMP5CJFQU3EBACWSGYRQB5LEE';

      localStorage.setItem('stellar-micropay:network', JSON.stringify({ network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' }));
      localStorage.setItem('stellar-micropay:last-public-key', alice);

      upsertAddressBookContact({ nickname: 'Alice', address: alice });
      localStorage.setItem('stellar-micropay:last-public-key', bob);
      upsertAddressBookContact({ nickname: 'Bob', address: bob });

      expect(loadAddressBookContacts()).toHaveLength(1);
      expect(loadAddressBookContacts().map((c) => c.nickname)).toEqual(['Bob']);

      localStorage.setItem('stellar-micropay:last-public-key', alice);
      localStorage.setItem('stellar-micropay:network', JSON.stringify({ network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' }));
      expect(loadAddressBookContacts()).toHaveLength(0);
    });

    it('migrates legacy contacts once into the namespaced key', () => {
      const legacyAddress = 'GCFVV3BKTNNXJ46CY2TLAGRYFSP23HKEMP5CJFQU3EBACWSGYRQB5LEE';

      localStorage.setItem('stellar-micropay:network', JSON.stringify({ network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' }));
      localStorage.setItem('stellar-micropay:last-public-key', 'GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV');
      localStorage.setItem('stellar-micropay:contacts', JSON.stringify([
        { id: 'legacy-1', nickname: 'Legacy', address: legacyAddress, createdAt: Date.now(), updatedAt: Date.now() },
      ]));

      const migrated = loadAddressBookContacts();
      expect(migrated).toHaveLength(1);
      expect(migrated[0].nickname).toBe('Legacy');
      expect(localStorage.getItem('stellar-micropay:contacts')).toBeNull();
      expect(JSON.parse(localStorage.getItem(getAddressBookStorageKey())!)[0].nickname).toBe('Legacy');
    });
  });

  describe('Remove contact deletes it from storage', () => {
    it('removes contact by id', () => {
      upsertAddressBookContact({
        nickname: 'Frank',
        address: VALID_ADDRESS_F,
      });

      const contacts = loadAddressBookContacts();
      const frank = contacts.find(c => c.nickname === 'Frank');
      expect(frank).toBeDefined();

      deleteAddressBookContact(frank!.id);

      const updatedContacts = loadAddressBookContacts();
      expect(updatedContacts.some(c => c.nickname === 'Frank')).toBe(false);
    });

    it('removes contact from localStorage', () => {
      upsertAddressBookContact({
        nickname: 'Grace',
        address: VALID_ADDRESS_G,
      });

      let contacts = loadAddressBookContacts();
      const grace = contacts.find(c => c.nickname === 'Grace');

      deleteAddressBookContact(grace!.id);

      const storageKey = getAddressBookStorageKey();
      const rawData = localStorage.getItem(storageKey);
      const parsedData = JSON.parse(rawData!);
      
      expect(parsedData.every((c: AddressBookContact) => c.nickname !== 'Grace')).toBe(true);
    });

    it('handles removing non-existent contact gracefully', () => {
      upsertAddressBookContact({
        nickname: 'Henry',
        address: VALID_ADDRESS_H,
      });

      const initialCount = loadAddressBookContacts().length;
      
      deleteAddressBookContact('non-existent-id');

      const finalCount = loadAddressBookContacts().length;
      expect(finalCount).toBe(initialCount);
    });
  });

  describe('Duplicate address is not added twice', () => {
    it('updates existing contact instead of adding duplicate', () => {
      const address = VALID_ADDRESS_A;

      upsertAddressBookContact({
        nickname: 'Original Name',
        address,
      });

      expect(loadAddressBookContacts()).toHaveLength(1);

      upsertAddressBookContact({
        nickname: 'Updated Name',
        address,
      });

      const contacts = loadAddressBookContacts();
      expect(contacts).toHaveLength(1);
      expect(contacts[0].nickname).toBe('Updated Name');
      expect(contacts[0].address).toBe(address);
    });

    it('preserves contact ID when updating', () => {
      const address = VALID_ADDRESS_B;

      upsertAddressBookContact({
        nickname: 'First',
        address,
      });

      const originalId = loadAddressBookContacts()[0].id;

      upsertAddressBookContact({
        nickname: 'Second',
        address,
      });

      const updatedId = loadAddressBookContacts()[0].id;
      expect(updatedId).toBe(originalId);
    });

    it('deduplicates contacts loaded from storage', () => {
      const storageKey = getAddressBookStorageKey();
      const duplicateAddress = VALID_ADDRESS_I;
      const duplicateData = [
        {
          id: '1',
          nickname: 'Dup1',
          address: duplicateAddress,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '2',
          nickname: 'Dup2',
          address: duplicateAddress,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      localStorage.setItem(storageKey, JSON.stringify(duplicateData));

      const contacts = loadAddressBookContacts();
      expect(contacts).toHaveLength(1);
    });
  });

  describe('Validation', () => {
    it('throws error for empty nickname', () => {
      expect(() => {
        upsertAddressBookContact({
          nickname: '   ',
          address: VALID_ADDRESS_I,
        });
      }).toThrow('Enter a nickname');
    });

    it('throws error for invalid Stellar address', () => {
      expect(() => {
        upsertAddressBookContact({
          nickname: 'Invalid',
          address: 'INVALID',
        });
      }).toThrow('Enter a valid Stellar public key');
    });

    it('trims whitespace from nickname and address', () => {
      upsertAddressBookContact({
        nickname: '  Trimmed  ',
        address: `  ${VALID_ADDRESS_J}  `,
      });

      const contacts = loadAddressBookContacts();
      expect(contacts[0].nickname).toBe('Trimmed');
      expect(contacts[0].address).toBe(VALID_ADDRESS_J);
    });
  });

  describe('Additional features', () => {
    it('toggles favourite status', () => {
      upsertAddressBookContact({
        nickname: 'Fav Test',
        address: VALID_ADDRESS_F,
        favourite: false,
      });

      const contacts1 = loadAddressBookContacts();
      const contact = contacts1[0];
      expect(contact.favourite).toBe(false);

      toggleFavouriteContact(contact.id);

      const contacts2 = loadAddressBookContacts();
      expect(contacts2[0].favourite).toBe(true);
    });

    it('updates contact tags', () => {
      upsertAddressBookContact({
        nickname: 'Tag Test',
        address: VALID_ADDRESS_G,
      });

      const contacts1 = loadAddressBookContacts();
      const contact = contacts1[0];

      updateContactTags(contact.id, ['work', 'important']);

      const contacts2 = loadAddressBookContacts();
      expect(contacts2[0].tags).toEqual(['work', 'important']);
    });

    it('collects all unique tags', () => {
      upsertAddressBookContact({
        nickname: 'User1',
        address: VALID_ADDRESS_H,
        tags: ['work', 'client'],
      });

      upsertAddressBookContact({
        nickname: 'User2',
        address: 'G' + 'Z'.repeat(55),
        tags: ['friend', 'work'],
      });

      const contacts = loadAddressBookContacts();
      const allTags = getAllTags(contacts);

      expect(allTags).toEqual(['client', 'friend', 'work']);
    });
  });
});

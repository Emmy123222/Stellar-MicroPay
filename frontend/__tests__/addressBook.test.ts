/**
 * __tests__/addressBook.test.ts
 * Unit tests for addressBook.ts (#517)
 */

// Mock isValidStellarAddress
jest.mock('../lib/stellar', () => ({
  isValidStellarAddress: (address: string) => {
    return typeof address === 'string' && address.startsWith('G') && address.length >= 10;
  },
}));

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

// Mock isValidStellarAddress using the same module path the app imports.
jest.mock('@/lib/stellar', () => ({
  isValidStellarAddress: (address: string) => {
    return (
      typeof address === 'string' &&
      address.startsWith('G') &&
      address.length >= 52 &&
      address.length <= 56
    );
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
        address: 'GABC123456789012345678901234567890123456789012345678',
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
        address: 'GDEF456789012345678901234567890123456789012345678901',
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
        address: 'GHIJ789012345678901234567890123456789012345678901234',
      });

      const contacts = loadAddressBookContacts();
      expect(contacts.some(c => c.nickname === 'Charlie')).toBe(true);
    });

    it('adds contact with optional fields', () => {
      upsertAddressBookContact({
        nickname: 'David',
        address: 'GKLM901234567890123456789012345678901234567890123456',
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
        address: 'GNOP012345678901234567890123456789012345678901234567',
      });

      expect(mockDispatchEvent).toHaveBeenCalled();
      const event = mockDispatchEvent.mock.calls[0][0];
      expect(event.type).toBe('stellar-micropay:contacts-updated');
    });
  });

  describe('Remove contact deletes it from storage', () => {
    it('removes contact by id', () => {
      upsertAddressBookContact({
        nickname: 'Frank',
        address: 'GQRS345678901234567890123456789012345678901234567890',
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
        address: 'GTUV678901234567890123456789012345678901234567890123',
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
        address: 'GWXY901234567890123456789012345678901234567890123456',
      });

      const initialCount = loadAddressBookContacts().length;
      
      deleteAddressBookContact('non-existent-id');

      const finalCount = loadAddressBookContacts().length;
      expect(finalCount).toBe(initialCount);
    });
  });

  describe('Duplicate address is not added twice', () => {
    it('updates existing contact instead of adding duplicate', () => {
      const address = 'GABC123456789012345678901234567890123456789012345678';

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
      const address = 'GDEF456789012345678901234567890123456789012345678901';

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
      const duplicateData = [
        {
          id: '1',
          nickname: 'Dup1',
          address: 'GHIJ789012345678901234567890123456789012345678901234',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '2',
          nickname: 'Dup2',
          address: 'GHIJ789012345678901234567890123456789012345678901234',
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
          address: 'GKLM901234567890123456789012345678901234567890123456',
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
        address: '  GNOP012345678901234567890123456789012345678901234567  ',
      });

      const contacts = loadAddressBookContacts();
      expect(contacts[0].nickname).toBe('Trimmed');
      expect(contacts[0].address).toBe('GNOP012345678901234567890123456789012345678901234567');
    });
  });

  describe('Additional features', () => {
    it('toggles favourite status', () => {
      upsertAddressBookContact({
        nickname: 'Fav Test',
        address: 'GQRS345678901234567890123456789012345678901234567890',
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
        address: 'GTUV678901234567890123456789012345678901234567890123',
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
        address: 'GWXY901234567890123456789012345678901234567890123456',
        tags: ['work', 'client'],
      });

      upsertAddressBookContact({
        nickname: 'User2',
        address: 'GZAB234567890123456789012345678901234567890123456789',
        tags: ['friend', 'work'],
      });

      const contacts = loadAddressBookContacts();
      const allTags = getAllTags(contacts);

      expect(allTags).toEqual(['client', 'friend', 'work']);
    });
  });
});

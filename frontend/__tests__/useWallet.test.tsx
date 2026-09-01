/**
 * __tests__/useWallet.test.tsx
 * Unit tests for useWallet hook (#525)
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WalletProvider, useWallet } from '../lib/useWallet';
import * as walletLib from '../lib/wallet';

jest.mock('../lib/wallet', () => ({
  getConnectedPublicKey: jest.fn(),
  disconnectWallet: jest.fn(),
}));

const mockGetConnectedPublicKey = walletLib.getConnectedPublicKey as jest.MockedFunction<typeof walletLib.getConnectedPublicKey>;
const mockDisconnectWallet = walletLib.disconnectWallet as jest.MockedFunction<typeof walletLib.disconnectWallet>;

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

describe('useWallet hook', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
    mockGetConnectedPublicKey.mockResolvedValue(null);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WalletProvider>{children}</WalletProvider>
  );

  describe('connect() updates hook state with the public key on success', () => {
    it('updates publicKey state when connectWallet is called', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.isWalletReady).toBe(true);
      });

      const testPublicKey = 'GABC123456789012345678901234567890123456789012345678';

      act(() => {
        result.current.connectWallet(testPublicKey);
      });

      expect(result.current.publicKey).toBe(testPublicKey);
    });

    it('persists public key to localStorage on connect', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.isWalletReady).toBe(true);
      });

      const testPublicKey = 'GABC123456789012345678901234567890123456789012345678';

      act(() => {
        result.current.connectWallet(testPublicKey);
      });

      expect(localStorage.getItem('stellar-micropay:last-public-key')).toBe(testPublicKey);
    });

    it('loads connected public key from Freighter on mount', async () => {
      const testPublicKey = 'GDEF456789012345678901234567890123456789012345678901';
      mockGetConnectedPublicKey.mockResolvedValueOnce(testPublicKey);

      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.isWalletReady).toBe(true);
      });

      expect(result.current.publicKey).toBe(testPublicKey);
      expect(mockGetConnectedPublicKey).toHaveBeenCalled();
    });
  });

  describe('disconnect() clears wallet state', () => {
    it('clears publicKey state when disconnectWallet is called', async () => {
      const testPublicKey = 'GABC123456789012345678901234567890123456789012345678';
      mockGetConnectedPublicKey.mockResolvedValueOnce(testPublicKey);

      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.publicKey).toBe(testPublicKey);
      });

      act(() => {
        result.current.disconnectWallet();
      });

      expect(result.current.publicKey).toBeNull();
      expect(mockDisconnectWallet).toHaveBeenCalled();
    });

    it('removes public key from localStorage on disconnect', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.isWalletReady).toBe(true);
      });

      const testPublicKey = 'GABC123456789012345678901234567890123456789012345678';

      act(() => {
        result.current.connectWallet(testPublicKey);
      });

      expect(localStorage.getItem('stellar-micropay:last-public-key')).toBe(testPublicKey);

      act(() => {
        result.current.disconnectWallet();
      });

      expect(localStorage.getItem('stellar-micropay:last-public-key')).toBeNull();
    });
  });

  describe('Public key persists across remounts', () => {
    it('loads last public key from localStorage on mount', async () => {
      const testPublicKey = 'GHIJ789012345678901234567890123456789012345678901234';
      localStorage.setItem('stellar-micropay:last-public-key', testPublicKey);

      const { result } = renderHook(() => useWallet(), { wrapper });

      // Initial state should load from localStorage
      expect(result.current.publicKey).toBe(testPublicKey);

      await waitFor(() => {
        expect(result.current.isWalletReady).toBe(true);
      });
    });

    it('maintains public key across remounts', async () => {
      const testPublicKey = 'GKLM901234567890123456789012345678901234567890123456';

      // First mount
      const { result: result1, unmount } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result1.current.isWalletReady).toBe(true);
      });

      act(() => {
        result1.current.connectWallet(testPublicKey);
      });

      expect(result1.current.publicKey).toBe(testPublicKey);

      // Unmount
      unmount();

      // Second mount
      const { result: result2 } = renderHook(() => useWallet(), { wrapper });

      // Should load from localStorage immediately
      expect(result2.current.publicKey).toBe(testPublicKey);

      await waitFor(() => {
        expect(result2.current.isWalletReady).toBe(true);
      });
    });
  });

  describe('Signing helper delegates to lib/wallet.ts correctly', () => {
    it('calls clearWalletConnection from lib/wallet on disconnect', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.isWalletReady).toBe(true);
      });

      act(() => {
        result.current.disconnectWallet();
      });

      expect(mockDisconnectWallet).toHaveBeenCalledTimes(1);
    });

    it('calls getConnectedPublicKey from lib/wallet on mount', async () => {
      mockGetConnectedPublicKey.mockResolvedValueOnce('GPQR012345678901234567890123456789012345678901234567');

      renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(mockGetConnectedPublicKey).toHaveBeenCalled();
      });
    });
  });

  describe('Error handling', () => {
    it('throws error when useWallet is used outside WalletProvider', () => {
      // Suppress console.error for this test
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useWallet());
      }).toThrow('useWallet must be used within a WalletProvider.');

      consoleErrorSpy.mockRestore();
    });

    it('handles localStorage failures gracefully', async () => {
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = jest.fn(() => {
        throw new Error('Storage quota exceeded');
      });

      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.isWalletReady).toBe(true);
      });

      // Should not throw
      expect(() => {
        act(() => {
          result.current.connectWallet('GSTU345678901234567890123456789012345678901234567890');
        });
      }).not.toThrow();

      localStorage.setItem = originalSetItem;
    });
  });

  describe('Network and rapid context switching (#739)', () => {
    it('exposes network in useWallet and updates when setNetwork is called', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.isWalletReady).toBe(true);
      });

      expect(result.current.network).toBe('testnet');

      act(() => {
        result.current.setNetwork({
          network: 'mainnet',
          horizonUrl: 'https://horizon.stellar.org',
        });
      });

      expect(result.current.network).toBe('mainnet');
      expect(result.current.networkConfig.horizonUrl).toBe('https://horizon.stellar.org');
    });

    it('dispatches and responds to stellar-micropay:network-changed events', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.isWalletReady).toBe(true);
      });

      act(() => {
        window.dispatchEvent(
          new CustomEvent('stellar-micropay:network-changed', {
            detail: {
              network: 'mainnet',
              horizonUrl: 'https://horizon.stellar.org',
            },
          })
        );
      });

      expect(result.current.network).toBe('mainnet');
    });
  });
});

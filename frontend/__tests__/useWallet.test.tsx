import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { WalletProvider, useWallet } from '../lib/useWallet';

const mockGetConnectedPublicKey = jest.fn();
const mockDisconnectWallet = jest.fn();

jest.mock('@/lib/wallet', () => ({
  getConnectedPublicKey: (...args: unknown[]) => mockGetConnectedPublicKey(...args),
  disconnectWallet: (...args: unknown[]) => mockDisconnectWallet(...args),
}));

const PUBLIC_KEY_A = 'GB5XVAABEQMY63WTHDQ5RXADGYF345VWMNPTN2GFUDZT57D57ZQTJ7PS';
const PUBLIC_KEY_B = 'GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD';

function TestConsumer() {
  const { publicKey, isWalletReady } = useWallet();
  return (
    <div>
      <span data-testid="public-key">{publicKey ?? 'none'}</span>
      <span data-testid="ready">{isWalletReady ? 'ready' : 'loading'}</span>
    </div>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGetConnectedPublicKey.mockReset();
  mockDisconnectWallet.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('WalletProvider account-change polling', () => {
  it('updates publicKey and shows a toast when Freighter switches to a different account', async () => {
    mockGetConnectedPublicKey.mockResolvedValue(PUBLIC_KEY_A);

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));
    expect(screen.getByTestId('public-key').textContent).toBe(PUBLIC_KEY_A);

    mockGetConnectedPublicKey.mockResolvedValue(PUBLIC_KEY_B);

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('public-key').textContent).toBe(PUBLIC_KEY_B);
    expect(screen.getByText('Freighter account changed — wallet updated')).toBeInTheDocument();
  });

  it('does not show a toast or change publicKey when the account stays the same', async () => {
    mockGetConnectedPublicKey.mockResolvedValue(PUBLIC_KEY_A);

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('public-key').textContent).toBe(PUBLIC_KEY_A);
    expect(screen.queryByText('Freighter account changed — wallet updated')).not.toBeInTheDocument();
  });

  it('does not treat a disconnect (null) as an account change requiring a toast', async () => {
    mockGetConnectedPublicKey.mockResolvedValue(PUBLIC_KEY_A);

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));

    mockGetConnectedPublicKey.mockResolvedValue(null);

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('public-key').textContent).toBe(PUBLIC_KEY_A);
    expect(screen.queryByText('Freighter account changed — wallet updated')).not.toBeInTheDocument();
  });
});

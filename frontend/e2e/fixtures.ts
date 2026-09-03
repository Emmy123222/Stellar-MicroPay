// playwright/e2e/fixtures.ts
import { test as base, expect } from '@playwright/test';

type WalletState = 'authenticated' | 'empty_balance' | 'insufficient_funds';

export const test = base.extend<{
  walletState: WalletState;
}>({
  walletState: ['authenticated', { option: true }],

  page: async ({ page, walletState }, use) => {
    // --- Horizon (Stellar network) ---
    await page.route('**/horizon.stellar.org/**', route => {
      const url = route.request().url();
      if (url.includes('/accounts/')) {
        const balance =
          walletState === 'empty_balance' ? '0.0000000' :
          walletState === 'insufficient_funds' ? '5.0000000' :
          '100.0000000';
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'test-account',
            balances: [{ asset_type: 'native', balance }],
          }),
        });
      } else if (url.includes('/transactions')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ _embedded: { records: [] } }),
        });
      } else if (url.includes('/fee_stats')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            last_ledger: '12345678',
            last_ledger_base_fee: '100',
            fee_charged: {
              max: '1000', min: '100', mode: '100',
              p10: '100', p20: '100', p30: '100', p40: '100',
              p50: '100', p60: '100', p70: '100', p80: '100',
              p90: '100', p95: '200', p99: '500',
            },
          }),
        });
      } else {
        route.fulfill({ status: 200, body: '{}' });
      }
    });

    // --- CoinGecko price ---
    await page.route('**/api.coingecko.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ stellar: { usd: 0.1 } }),
      });
    });

    // --- Backend payment stats API ---
    await page.route('**/api/payments/**/stats', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            publicKey: 'GTESTPUBKEYMOCKED',
            totalSentXLM: '0.00',
            totalReceivedXLM: '0.00',
            sentCount: 0,
            receivedCount: 0,
            totalTransactions: 0,
          },
        }),
      });
    });

    // --- Backend auth API mocks ---
    await page.route('**/api/auth**', route => {
      if (route.request().method() === 'GET') {
        // GET /api/auth?account=... returns challenge transaction
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            transaction: 'AAAAAgAAAAD8...mock_challenge_xdr' // mock XDR
          }),
        });
      } else if (route.request().method() === 'POST') {
        // POST /api/auth with signed transaction returns JWT
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            token: 'mock_jwt_token'
          }),
        });
      }
    });

    // --- Freighter wallet mock ---
    const publicKeyMap: Record<WalletState, string> = {
      authenticated: 'GTESTPUBKEYMOCKED',
      empty_balance: 'GEMPTYBALANCE',
      insufficient_funds: 'GINSUFFICIENTFUNDS',
    };
    const publicKey = publicKeyMap[walletState];

    await page.addInitScript(
      ({ publicKey }: { publicKey: string }) => {
        // Mock the freighter-api package by overriding the module exports
        // Since ES modules are hard to mock, we override the global freighter object
        // that the package checks for
        (window as any).freighter = {
          isConnected: async () => ({ isConnected: true }),
          getPublicKey: async () => ({ publicKey }),
          requestAccess: async () => ({}),
          signTransaction: async (xdr: string) => ({ signedTransaction: xdr + '_signed' }),
          isAllowed: async () => ({ isAllowed: true }),
        };
      },
      { publicKey },
    );

    await use(page);
  },
});

export { expect };
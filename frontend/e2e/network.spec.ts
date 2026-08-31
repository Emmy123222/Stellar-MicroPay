import { test, expect } from '@playwright/test';

// #540 — e2e coverage for pages/network.tsx: it should reflect the active
// Stellar network (via the Navbar badge, driven by NEXT_PUBLIC_STELLAR_NETWORK)
// and render its Horizon-backed stats without errors.

const LEDGER_RECORDS = Array.from({ length: 10 }, (_, i) => ({
  sequence: 1_000_000 - i,
  closed_at: new Date(Date.now() - i * 5_000).toISOString(),
  successful_transaction_count: 42 + i,
}));

const FEE_STATS_BODY = {
  last_ledger: '1000000',
  last_ledger_base_fee: '100',
  ledger_capacity_usage: '0.5',
  fee_charged: {
    max: '1000', min: '100', mode: '100',
    p10: '100', p20: '100', p30: '100', p40: '100',
    p50: '150', p60: '100', p70: '100', p80: '100',
    p90: '100', p95: '200', p99: '500',
  },
  max_fee: {
    max: '1000', min: '100', mode: '100',
    p10: '100', p20: '100', p30: '100', p40: '100',
    p50: '100', p60: '100', p70: '100', p80: '100',
    p90: '100', p95: '100', p99: '100',
  },
};

test.beforeEach(async ({ page }) => {
  // Mock Freighter so no browser extension is needed (Navbar/WalletProvider
  // probe for it on mount even though this page doesn't require a wallet).
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: false }),
      getAddress: async () => ({ address: '' }),
      getPublicKey: async () => ({ publicKey: '' }),
      signTransaction: async () => ({ signedTxXdr: '' }),
      requestAccess: async () => ({}),
      isAllowed: async () => ({ isAllowed: false }),
    };
  });

  // fetchNetworkStats() calls server.ledgers() and server.feeStats() against
  // Horizon — mock both so the page renders deterministic data offline.
  await page.route('**/horizon-testnet.stellar.org/ledgers**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ _embedded: { records: LEDGER_RECORDS } }),
    });
  });

  await page.route('**/horizon-testnet.stellar.org/fee_stats**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FEE_STATS_BODY),
    });
  });
});

test('network page shows the active network (testnet) indicator', async ({ page }) => {
  await page.goto('/network');

  // The e2e webServer runs with NEXT_PUBLIC_STELLAR_NETWORK=testnet, and the
  // Navbar renders a "Testnet"/"Mainnet" badge sourced from that config.
  const badge = page.getByText('Testnet', { exact: true });
  await expect(badge).toBeVisible();
});

test('network stats render without errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/network');

  await expect(
    page.getByRole('heading', { name: 'Stellar Network Statistics' })
  ).toBeVisible();

  // Stats grid populated from the mocked Horizon responses.
  await expect(page.getByText('#1,000,000').first()).toBeVisible();
  await expect(page.getByText('Avg Transactions')).toBeVisible();
  await expect(page.getByText('Base Fee', { exact: true })).toBeVisible();
  await expect(page.getByText('P50 Fee')).toBeVisible();
  await expect(page.getByText('P95 Fee')).toBeVisible();
  await expect(page.getByText('P99 Fee')).toBeVisible();

  // No error state and no uncaught client-side exceptions.
  await expect(page.getByText('Network Error')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('network graph exposes health metrics and keyboard-accessible samples', async ({ page }) => {
  await page.goto('/network');

  const health = page.getByRole('region', { name: 'Network health' });
  await expect(health).toContainText('Testnet');
  await expect(health).toContainText('Network-wide statistics');
  await expect(health).toContainText('Horizon API');
  await expect(health).toContainText('1,000,000');
  await expect(health).toContainText('Operational');

  const sample = page.getByRole('button', { name: /Latency/ }).first();
  await expect(sample).toBeAttached();
  await sample.focus();
  await expect(sample).toBeFocused();
});

test('network page shows an error state when Horizon requests fail', async ({ page }) => {
  await page.unroute('**/horizon-testnet.stellar.org/ledgers**');
  await page.route('**/horizon-testnet.stellar.org/ledgers**', (route) => {
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/network');

  await expect(page.getByRole('heading', { name: 'Network Error' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
});

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: false }),
      getPublicKey: async () => ({ publicKey: '' }),
      signTransaction: async () => ({ signedTransaction: '' }),
      requestAccess: async () => ({}),
      isAllowed: async () => ({ isAllowed: false }),
    };
  });
});

test('transactions page shows wallet connect prompt when no wallet connected', async ({ page }) => {
  await page.goto('/transactions');

  await expect(page).toHaveURL('/transactions');

  const heading = page.getByRole('heading', { name: 'Transaction History' });
  await expect(heading).toBeVisible();

  const prompt = page.getByText('Connect your wallet to view your payments');
  await expect(prompt).toBeVisible();

  const connectBtn = page.getByRole('button', { name: /Connect Freighter Wallet/i });
  await expect(connectBtn).toBeVisible();
});
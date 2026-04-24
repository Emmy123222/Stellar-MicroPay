import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: async () => false,
      getPublicKey: async () => '',
      signTransaction: async () => '',
    };
  });
});

test('dashboard shows wallet connect prompt when no wallet connected', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL('/dashboard');

  const heading = page.getByRole('heading', { name: 'Dashboard' });
  await expect(heading).toBeVisible();

  const prompt = page.getByText('Connect your wallet to get started');
  await expect(prompt).toBeVisible();

  const connectBtn = page.getByRole('button', { name: /Connect Freighter Wallet/i });
  await expect(connectBtn).toBeVisible();
});
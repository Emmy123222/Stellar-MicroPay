import { test, expect } from '@playwright/test';

// Mock Freighter so no browser extension is needed
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: async () => false,
      getPublicKey: async () => '',
      signTransaction: async () => '',
    };
  });
});

test('landing page loads with correct title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Stellar-MicroPay | Instant Micropayments');
});

test('landing page shows hero heading', async ({ page }) => {
  await page.goto('/');
  const heading = page.locator('h1');
  await expect(heading).toContainText('Money moves at the');
  await expect(heading).toContainText('speed of light');
});

test('Connect Wallet & Start button is visible on landing page', async ({ page }) => {
  await page.goto('/');
  const btn = page.getByRole('button', { name: 'Connect Wallet & Start' });
  await expect(btn).toBeVisible();
});

test('clicking Connect Wallet & Start opens the WalletConnect modal', async ({ page }) => {
  await page.goto('/');
  const btn = page.getByRole('button', { name: 'Connect Wallet & Start' });
  await btn.click();

  const walletHeading = page.getByRole('heading', { name: 'Connect your wallet' });
  await expect(walletHeading).toBeVisible();
});

test('Cancel button closes the WalletConnect modal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Wallet & Start' }).click();
  await expect(page.getByRole('heading', { name: 'Connect your wallet' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Connect your wallet' })).not.toBeVisible();
});
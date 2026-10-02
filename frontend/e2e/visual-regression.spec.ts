import { test, expect } from '@playwright/test';

// Visual regression tests for key pages.
// Generate/update baselines with: npx playwright test e2e/visual-regression.spec.ts --update-snapshots

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

  // Keep live price data out of the screenshots
  await page.route('**/api.coingecko.com/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stellar: { usd: 0.1 } }),
    }),
  );

  await page.setViewportSize({ width: 1280, height: 800 });
});

const screenshotOptions = {
  fullPage: true,
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixelRatio: 0.01,
};

test('landing page matches visual baseline', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Money moves at the');
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot('landing.png', screenshotOptions);
});

test('dashboard page matches visual baseline', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByText('Connect your wallet to get started')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot('dashboard.png', screenshotOptions);
});

test('transactions page matches visual baseline', async ({ page }) => {
  await page.goto('/transactions');
  await expect(page.getByText('Connect your wallet to view your payments')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot('transactions.png', screenshotOptions);
});

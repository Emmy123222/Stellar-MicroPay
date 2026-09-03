import { expect, test } from '@playwright/test';

test('landing page renders the primary wallet journey', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: false }),
      getPublicKey: async () => ({ publicKey: '' }),
      signTransaction: async () => ({ signedTransaction: '' }),
      requestAccess: async () => ({}),
      isAllowed: async () => ({ isAllowed: false }),
    };
  });

  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Home | Stellar-MicroPay');
  await expect(page.getByRole('heading', { name: /Money moves at the speed of light/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /connect wallet to start sending payments/i })).toBeVisible();
});

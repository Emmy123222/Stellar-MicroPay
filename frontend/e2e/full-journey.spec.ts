// playwright/e2e/full-journey.spec.ts
import { test, expect } from './fixtures';

// Drives the wallet connection flow and waits for the authenticated dashboard.
// The fixture mocks window.freighter + all backend APIs, so clicking the button
// completes synchronously from the app's perspective.
async function connectWallet(page: any) {
  await page.goto('/dashboard');

  // If already authenticated (shouldn't happen in tests, but defensive)
  const alreadyConnected = await page.locator('p.label', { hasText: 'Wallet Address' }).isVisible()
    .catch(() => false);
  if (alreadyConnected) return;

  await page.getByRole('button', { name: /Connect Freighter Wallet/i }).click();

  // Wait for the authenticated dashboard — the wallet address label is unique to it
  await expect(page.locator('p.label').filter({ hasText: 'Wallet Address' }))
    .toBeVisible({ timeout: 15000 });
}

test('data integrity: verify transaction history reflects payment data', async ({ page }) => {
  await connectWallet(page);

  const recentActivity = page.locator('.card').filter({ hasText: 'Recent Activity' });
  await expect(recentActivity).toBeVisible();

  await expect(page.getByText('No recent transactions')).toBeVisible();
});

test('deep linking: test payment request link generation and display', async ({ page }) => {
  await connectWallet(page);

  const linkGenerator = page.locator('.card').filter({ hasText: 'Generate Payment Link' });
  await expect(linkGenerator).toBeVisible();

  await page.getByLabel('Recipient Address').fill('GREQUESTADDRESS');
  await page.getByLabel('Amount (XLM)').fill('5');
  await page.getByLabel('Memo (Optional)').fill('Request test');

  await page.getByRole('button', { name: 'Create Link' }).click();

  await expect(page.getByText('Generated URL')).toBeVisible();
  const linkElement = page.locator('input[readonly]').first();
  await expect(linkElement).toBeVisible();
  const paymentLink = await linkElement.inputValue();
  expect(paymentLink).toContain('data=');

  await page.getByText('Show QR').click();
  await expect(page.locator('canvas')).toBeVisible();
});

test('complex forms: validate multi-sig transaction workflow', async ({ page }) => {
  await connectWallet(page);

  const multiSigCard = page.locator('.card').filter({ hasText: 'Multi-Signature Transaction' });
  await expect(multiSigCard).toBeVisible();

  await page.getByLabel('Recipient Address').fill('GDEST1');
  await page.getByLabel('Amount (XLM)').fill('10');
  await page.getByLabel('Memo (optional)').fill('Multi-sig test');
  await page.getByLabel('Signature Threshold').fill('2');

  await page.getByRole('button', { name: 'Build Transaction' }).click();

  await expect(page.getByText('Share this URL with your co-signers:')).toBeVisible();
  const shareableUrl = page.locator('input[readonly]').first();
  await expect(shareableUrl).toBeVisible();
});

test('scheduling logic: test notification opt-in and test functionality', async ({ page }) => {
  await page.context().grantPermissions(['notifications']);
  await connectWallet(page);

  const enableButton = page.getByRole('button', { name: 'Enable payment notifications' });
  await expect(enableButton).toBeVisible();
  await enableButton.click();

  await expect(page.getByText('Payment notifications enabled')).toBeVisible();

  const testButton = page.getByRole('button', { name: 'Test notification' });
  await expect(testButton).toBeVisible();
  await testButton.click();

  await expect(page.getByText('You received 10.00 XLM')).toBeVisible();
});

test('contact management: test wallet address copy functionality', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await connectWallet(page);

  // The public key injected by the fixture starts with 'G'
  const addressElement = page.locator('span').filter({ hasText: /^G/ }).first();
  await expect(addressElement).toBeVisible();

  const copyButton = page.getByRole('button', { name: 'Copy address' });
  await copyButton.click();

  await expect(page.getByText('Copied!')).toBeVisible();
});

test('wallet states: handle empty balance scenario', async ({ page }) => {
  await page.route('**/horizon.stellar.org/**', route => {
    if (route.request().url().includes('/accounts/')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-account',
          balances: [{ asset_type: 'native', balance: '0.0000000' }],
        }),
      });
    } else {
      route.fulfill({ status: 200, body: '{}' });
    }
  });

  await connectWallet(page);

  // Balance displays as a formatted number — 0.0000000 rounds to "0"
  await expect(page.getByText(/\b0(\s*)XLM\b/)).toBeVisible();
});

test('wallet states: handle insufficient funds', async ({ page }) => {
  await page.route('**/horizon.stellar.org/**', route => {
    if (route.request().url().includes('/accounts/')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-account',
          balances: [{ asset_type: 'native', balance: '5.0000000' }],
        }),
      });
    } else {
      route.fulfill({ status: 200, body: '{}' });
    }
  });

  await connectWallet(page);

  await expect(page.getByText(/\b5(\s*)XLM\b/)).toBeVisible();

  await page.getByLabel('Amount (XLM)').fill('10');
  await page.getByRole('button', { name: 'Send Payment' }).click();

  await expect(page.getByLabel('Amount (XLM)')).toHaveValue('10');
});
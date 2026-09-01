/**
 * E2E tests for shareable payment links page /pay (issue #541).
 * SEP-0007 deep link handling specs:
 *  1. Visiting /pay with valid SEP-0007 query params pre-fills destination, amount, and memo.
 *  2. Visiting /pay with invalid/malformed query params shows a clear error instead of a blank form.
 *  3. Visiting /pay with an expired link shows an expired payment error.
 */
import { test as base, expect } from '@playwright/test';
import { test as authenticatedTest } from './fixtures';

const VALID_DESTINATION = 'GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV';
const VALID_AMOUNT = '15.5';
const VALID_MEMO = 'invoice-101';

base.describe('pay page - disconnected', () => {
  base.beforeEach(async ({ page }) => {
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

  base('visiting /pay with valid SEP-0007 params prompts for wallet connect and shows payment header', async ({ page }) => {
    await page.goto(`/pay?to=${VALID_DESTINATION}&amount=${VALID_AMOUNT}&memo=${VALID_MEMO}`);

    await expect(page.getByRole('heading', { name: 'Complete Payment' })).toBeVisible();
    await expect(
      page.getByText('You’ve received a payment request. Connect your wallet to proceed.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Connect Freighter Wallet/i })).toBeVisible();
  });

  base('visiting /pay with incomplete params shows malformed payment link error', async ({ page }) => {
    // Missing amount param
    await page.goto(`/pay?to=${VALID_DESTINATION}`);

    await expect(page.getByRole('heading', { name: 'Payment Unavailable' })).toBeVisible();
    await expect(page.getByText('The payment link data is incomplete or malformed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to Dashboard' })).toBeVisible();

    // Form inputs should not be present
    await expect(page.getByLabel('Destination')).not.toBeVisible();
  });

  base('visiting /pay with invalid expiry timestamp shows invalid expiry error', async ({ page }) => {
    await page.goto(`/pay?to=${VALID_DESTINATION}&amount=${VALID_AMOUNT}&expires=not_a_number`);

    await expect(page.getByRole('heading', { name: 'Payment Unavailable' })).toBeVisible();
    await expect(page.getByText('The payment link expiry timestamp is invalid.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to Dashboard' })).toBeVisible();
  });

  base('visiting /pay with an expired link shows link expired error', async ({ page }) => {
    // Timestamp 1000000000 (year 2001) is in the past
    await page.goto(`/pay?to=${VALID_DESTINATION}&amount=${VALID_AMOUNT}&expires=1000000000`);

    await expect(page.getByRole('heading', { name: 'Payment Unavailable' })).toBeVisible();
    await expect(page.getByText('This payment link has expired.')).toBeVisible();
  });
});

authenticatedTest.describe('pay page - authenticated', () => {
  authenticatedTest('visiting /pay with valid SEP-0007 params pre-fills payment form inputs', async ({ page }) => {
    await page.goto(`/pay?to=${VALID_DESTINATION}&amount=${VALID_AMOUNT}&memo=${VALID_MEMO}`);

    await expect(page.getByRole('heading', { name: 'Complete Payment' })).toBeVisible();
    await expect(
      page.getByText('Review the details below to authorize the transaction.')
    ).toBeVisible();

    // Verify form fields are pre-filled with the query parameter values
    const destinationInput = page.locator('input[placeholder*="G..."]');
    await expect(destinationInput).toHaveValue(VALID_DESTINATION);

    const amountInput = page.locator('input[placeholder="0.0000000"]');
    await expect(amountInput).toHaveValue(VALID_AMOUNT);

    const memoInput = page.locator('input[placeholder="Payment note..."]');
    await expect(memoInput).toHaveValue(VALID_MEMO);
  });
});

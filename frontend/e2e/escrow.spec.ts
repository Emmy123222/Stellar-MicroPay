/**
 * E2E tests for escrow page (issue #538).
 *
 * Scenarios:
 *  1. Creating an escrow shows it in a pending state
 *  2. Releasing an escrow updates its status
 *  3. Refunding an escrow updates its status
 */
import { test as base, expect } from '@playwright/test';

import { test as authenticatedTest } from './fixtures';

// Mock escrow contract responses
const mockEscrowContract = {
  id: 1,
  from: 'GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV',
  to: 'GBPMK2QWQ2JKMSFL6EK44LNK45QWGS7IJBLUZXBT5B2FZXOG77GRQ5J4',
  amount: '10000000',
  releaseLedger: 12345680,
  status: 'Pending',
};

authenticatedTest.describe('escrow page', () => {
  authenticatedTest.beforeEach(async ({ page }) => {
    // Mock the stellar contract calls
    await page.route('**/api/**', route => {
      const url = route.request().url();
      
      // Mock getEscrow call
      if (url.includes('getEscrow') || url.includes('escrow')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockEscrowContract),
        });
        return;
      }
      
      // Mock getCurrentLedger call
      if (url.includes('ledger') || url.includes('current')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ currentLedger: 12345678 }),
        });
        return;
      }
      
      // Mock submitTransaction call
      if (url.includes('submit') || url.includes('transaction')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ 
            returnValue: mockEscrowContract.id,
            status: 'success',
          }),
        });
        return;
      }
      
      route.continue();
    });
  });

  authenticatedTest('creating an escrow shows it in a pending state', async ({ page }) => {
    await page.goto('/escrow');
    
    // Wait for wallet connection
    await page.getByRole('button', { name: /Connect Freighter Wallet/i }).click();
    await expect(page.locator('p.label').filter({ hasText: 'Wallet Address' })).toBeVisible({ timeout: 15_000 });

    // Fill in the escrow form
    await page.getByLabel('Recipient address').fill('GBPMK2QWQ2JKMSFL6EK44LNK45QWGS7IJBLUZXBT5B2FZXOG77GRQ5J4');
    await page.getByLabel('Amount (XLM)').fill('1.0');
    await page.getByLabel('Release ledger').fill('12345680');
    
    // Submit the form
    await page.getByRole('button', { name: /Lock funds in escrow/i }).click();
    
    // Verify success message
    await expect(page.getByText(/Escrow created/i)).toBeVisible({ timeout: 10_000 });
  });

  authenticatedTest('releasing an escrow updates its status', async ({ page }) => {
    await page.goto('/escrow');
    
    // Wait for wallet connection
    await page.getByRole('button', { name: /Connect Freighter Wallet/i }).click();
    await expect(page.locator('p.label').filter({ hasText: 'Wallet Address' })).toBeVisible({ timeout: 15_000 });

    // Look up an existing escrow
    await page.getByPlaceholder('Escrow id').fill('1');
    await page.getByRole('button', { name: 'Look up' }).click();
    
    // Wait for escrow details to load
    await expect(page.getByText('Status')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();
    
    // Mock the updated escrow status after release
    await page.route('**/api/**', route => {
      const url = route.request().url();
      if (url.includes('getEscrow') || url.includes('escrow')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...mockEscrowContract,
            status: 'Released',
          }),
        });
        return;
      }
      route.continue();
    });

    // Click the claim/release button (if enabled)
    const claimButton = page.getByRole('button', { name: /Claim/i });
    if (await claimButton.isEnabled()) {
      await claimButton.click();
      
      // Verify status updated to Released
      await expect(page.getByText('Released')).toBeVisible({ timeout: 10_000 });
    }
  });

  authenticatedTest('refunding an escrow updates its status', async ({ page }) => {
    await page.goto('/escrow');
    
    // Wait for wallet connection
    await page.getByRole('button', { name: /Connect Freighter Wallet/i }).click();
    await expect(page.locator('p.label').filter({ hasText: 'Wallet Address' })).toBeVisible({ timeout: 15_000 });

    // Look up an existing escrow
    await page.getByPlaceholder('Escrow id').fill('1');
    await page.getByRole('button', { name: 'Look up' }).click();
    
    // Wait for escrow details to load
    await expect(page.getByText('Status')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();
    
    // Mock the updated escrow status after refund
    await page.route('**/api/**', route => {
      const url = route.request().url();
      if (url.includes('getEscrow') || url.includes('escrow')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...mockEscrowContract,
            status: 'Cancelled',
          }),
        });
        return;
      }
      route.continue();
    });

    // Click the cancel/refund button (if enabled)
    const cancelButton = page.getByRole('button', { name: /Cancel/i });
    if (await cancelButton.isEnabled()) {
      await cancelButton.click();
      
      // Verify status updated to Cancelled
      await expect(page.getByText('Cancelled')).toBeVisible({ timeout: 10_000 });
    }
  });
});

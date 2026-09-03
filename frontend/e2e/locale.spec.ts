import { test, expect } from '@playwright/test';

// Mock Freighter so no browser extension is needed
test.beforeEach(async ({ page }) => {
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
});

const htmlLang = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.lang);
const htmlDir = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.dir);

test('lang/dir match the stored locale before and after a reload', async ({ page }) => {
  // Preset a stored locale before any page script runs (pre-hydration path).
  await page.addInitScript(() => {
    localStorage.setItem('stellar-micropay:locale', 'es');
  });

  await page.goto('/');

  await expect.poll(() => htmlLang(page)).toBe('es');
  await expect.poll(() => htmlDir(page)).toBe('ltr');

  // No flash/mismatch across a full reload: init script re-applies before hydration.
  await page.reload();
  await expect.poll(() => htmlLang(page)).toBe('es');
  await expect.poll(() => htmlDir(page)).toBe('ltr');
});

test('switching locale in the navbar updates lang/dir and persists', async ({ page }) => {
  await page.goto('/');

  const select = page.getByRole('combobox', { name: 'Select language' });
  await select.selectOption('es');

  await expect.poll(() => htmlLang(page)).toBe('es');
  await expect.poll(() => htmlDir(page)).toBe('ltr');

  await page.reload();
  await expect.poll(() => htmlLang(page)).toBe('es');
});

test('language selector shows native language names', async ({ page }) => {
  await page.goto('/');

  const select = page.getByRole('combobox', { name: 'Select language' });
  await expect(select.locator('option')).toHaveCount(2);
  await expect(select.locator('option')).toHaveText(['English', 'Español']);
});
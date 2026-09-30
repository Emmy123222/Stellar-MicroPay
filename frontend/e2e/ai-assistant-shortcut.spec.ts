import { test, expect } from '@playwright/test';

// No wallet needed — the shortcut and dialog must work from any page,
// connected or not.
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

const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';

test('Ctrl/Cmd+K opens the AI payment assistant from the landing page', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press(`${modifierKey}+K`);

  await expect(page.getByRole('dialog', { name: 'AI Payment Assistant' })).toBeVisible();
});

test('Ctrl/Cmd+K opens the assistant from a page other than the landing page', async ({ page }) => {
  await page.goto('/network');

  await page.keyboard.press(`${modifierKey}+K`);

  await expect(page.getByRole('dialog', { name: 'AI Payment Assistant' })).toBeVisible();
});

test('Escape closes the assistant', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press(`${modifierKey}+K`);
  await expect(page.getByRole('dialog', { name: 'AI Payment Assistant' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog', { name: 'AI Payment Assistant' })).not.toBeVisible();
});

test('the trigger button in the Navbar also opens the assistant', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Open AI payment assistant/i }).click();

  await expect(page.getByRole('dialog', { name: 'AI Payment Assistant' })).toBeVisible();
});

test('the trigger button has an accessible label mentioning the keyboard shortcut', async ({ page }) => {
  await page.goto('/');

  const trigger = page.getByRole('button', { name: /Open AI payment assistant/i });
  await expect(trigger).toHaveAttribute('title', /Cmd\+K.*Ctrl\+K/);
  await expect(trigger).toHaveAccessibleName(/Command K.*Control K/i);
});

test('pressing Ctrl/Cmd+K again while open closes it (toggle)', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press(`${modifierKey}+K`);
  await expect(page.getByRole('dialog', { name: 'AI Payment Assistant' })).toBeVisible();

  await page.keyboard.press(`${modifierKey}+K`);

  await expect(page.getByRole('dialog', { name: 'AI Payment Assistant' })).not.toBeVisible();
});

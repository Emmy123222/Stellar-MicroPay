import { test, expect } from './fixtures';

test.describe('tip page flow', () => {
  test('selects an amount and keeps the send flow wallet-backed', async ({ page }) => {
    await page.route('**/api/accounts/resolve/testuser', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            username: 'testuser',
            publicKey: 'GTESTPUBKEYMOCKED',
          },
        }),
      })
    );
    await page.route('**/api/tips', route =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 'mock-tip' } }),
      })
    );

    await page.goto('/tip/testuser');
    await expect(page.getByRole('heading', { name: 'Tip @testuser' })).toBeVisible();
    await page.getByRole('button', { name: /\$5 tip/i }).click();
    await expect(page.getByText('2 XLM')).toBeVisible();
    await expect(page.getByRole('button', { name: /connect wallet to tip 2/i })).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';

// A real 56-character Stellar public key, so the overflow bug (only
// reproducible with the full-length key, not the 18-char mock used
// elsewhere in this repo's fixtures) is actually exercised.
const REAL_PUBLIC_KEY =
  'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA';

test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE

test.beforeEach(async ({ page }) => {
  // @stellar/freighter-api talks to the real extension over window.postMessage
  // (type: "FREIGHTER_EXTERNAL_MSG_REQUEST" -> "FREIGHTER_EXTERNAL_MSG_RESPONSE"),
  // not by calling a plain `window.freighter` object directly (isConnected() is
  // the one exception). Reply to that protocol here so getPublicKey()/isAllowed()
  // actually resolve in a headless browser with no real extension installed.
  await page.addInitScript((publicKey: string) => {
    (window as any).freighter = { isConnected: true };

    window.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; messageId?: number } | undefined;
      if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;

      const responsesByType: Record<string, unknown> = {
        REQUEST_CONNECTION_STATUS: { isConnected: true },
        REQUEST_ALLOWED_STATUS: { isAllowed: true },
        REQUEST_PUBLIC_KEY: { publicKey },
        REQUEST_ACCESS: { publicKey },
      };
      const body = data.type ? responsesByType[data.type] : undefined;
      if (!body) return;

      window.postMessage(
        {
          source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
          messagedId: data.messageId,
          ...(body as object),
        },
        window.location.origin,
      );
    });
  }, REAL_PUBLIC_KEY);
});

test('Navbar does not overflow horizontally at 375x667 with a connected wallet', async ({ page }) => {
  await page.goto('/');

  const addressPill = page.locator('.address-pill');
  await expect(addressPill).toBeVisible();

  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  const viewportWidth = await page.evaluate(() => window.innerWidth);

  expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
});

test('the full 56-character public key is never rendered verbatim in the Navbar', async ({ page }) => {
  await page.goto('/');

  const nav = page.locator('nav').first();
  await expect(nav).toBeVisible();

  const navText = await nav.innerText();
  expect(navText).not.toContain(REAL_PUBLIC_KEY);
});

test('the address pill stays within the viewport bounds', async ({ page }) => {
  await page.goto('/');

  const addressPill = page.locator('.address-pill');
  await expect(addressPill).toBeVisible();

  const box = await addressPill.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.x + box.width).toBeLessThanOrEqual(375 + 1); // +1px rounding tolerance
  }
});

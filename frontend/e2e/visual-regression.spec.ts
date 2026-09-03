/**
 * Visual regression tests for key pages.
 *
 * Baseline screenshots are stored in __screenshots__/ next to this file.
 * On first run, Playwright creates the baselines automatically.
 * Subsequent runs compare against them and fail if the pixel diff exceeds
 * the configured threshold (maxDiffPixelRatio: 0.01 = 1%).
 *
 * To update baselines after intentional UI changes:
 *   npx playwright test --update-snapshots
 *
 * Reference: https://playwright.dev/docs/test-snapshots
 */

import { test, expect } from "@playwright/test";

// ── Shared mock: Freighter wallet (disconnected) ──────────────────────────
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: false }),
      getPublicKey: async () => ({ publicKey: "" }),
      signTransaction: async () => ({ signedTransaction: "" }),
      requestAccess: async () => ({}),
      isAllowed: async () => ({ isAllowed: false }),
    };
  });
});

// ── Landing page ──────────────────────────────────────────────────────────
test.describe("Landing page visual regression", () => {
  test("full page screenshot matches baseline", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Wait for any CSS animations / particles to settle
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot("landing-fullpage.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("hero section screenshot matches baseline", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator("h1");
    await expect(hero).toBeVisible();
    await page.waitForTimeout(500);
    await expect(hero).toHaveScreenshot("landing-hero.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});

// ── Dashboard page (unauthenticated) ──────────────────────────────────────
test.describe("Dashboard page visual regression", () => {
  test("full page screenshot matches baseline (no wallet)", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("dashboard-unauthenticated.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});

// ── Pay page (payment link landing) ───────────────────────────────────────
test.describe("Pay page visual regression", () => {
  test("full page screenshot matches baseline (no query params)", async ({ page }) => {
    await page.goto("/pay");
    await expect(page.getByRole("heading", { name: "Complete Payment" })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("pay-page-empty.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("pay page with invalid link shows error state", async ({ page }) => {
    await page.goto("/pay?data=invalid&amount=abc");
    await expect(page.getByText("Payment Unavailable")).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("pay-page-error.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});

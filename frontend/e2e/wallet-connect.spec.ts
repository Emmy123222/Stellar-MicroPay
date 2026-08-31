/**
 * E2E tests for wallet connect flow (issue #223).
 *
 * Scenarios:
 *  1. Dashboard shows 'Connect wallet' prompt when no Freighter extension is present.
 *  2. After mock-connecting Freighter, wallet address and balance are displayed.
 *  3. Navigating to /transactions after connect shows the transaction list.
 */
import { test as base, expect } from "@playwright/test";
import { test as authenticatedTest } from "./fixtures";

// ── Scenario 1: no extension present ─────────────────────────────────────────

base.describe("wallet not connected", () => {
  base.beforeEach(async ({ page }) => {
    // Freighter stub that reports it is NOT installed / connected.
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

  base.test("dashboard shows Connect wallet prompt and button", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Connect your wallet to get started")).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect Freighter Wallet/i })).toBeVisible();
  });

  base.test("transactions page shows Connect wallet prompt and button", async ({ page }) => {
    await page.goto("/transactions");

    await expect(page.getByRole("heading", { name: "Transaction History" })).toBeVisible();
    await expect(page.getByText("Connect your wallet to view your payments")).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect Freighter Wallet/i })).toBeVisible();
  });
});

// ── Scenario 2 & 3: Freighter mock-connected ──────────────────────────────────
// Uses the shared fixture that injects a fully-mocked freighter + backend.

authenticatedTest(
  "after mock connect, wallet address and XLM balance are displayed on dashboard",
  async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Connect Freighter Wallet/i }).click();

    // Wallet address card becomes visible once connected.
    const addressLabel = page.locator("p.label").filter({ hasText: "Wallet Address" });
    await expect(addressLabel).toBeVisible({ timeout: 15_000 });

    // Balance card is rendered with an XLM suffix.
    await expect(page.locator("p.label").filter({ hasText: "XLM Balance" })).toBeVisible();
    await expect(page.getByText(/XLM/)).toBeVisible();
  }
);

authenticatedTest(
  "after mock connect, navigating to /transactions shows the transaction list",
  async ({ page }) => {
    // Connect wallet first via the dashboard.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Connect Freighter Wallet/i }).click();

    // Wait until dashboard is authenticated.
    await expect(page.locator("p.label").filter({ hasText: "Wallet Address" })).toBeVisible({
      timeout: 15_000,
    });

    // Navigate to the transactions page.
    await page.goto("/transactions");

    // The authenticated view renders the heading and transaction list container.
    await expect(page.getByRole("heading", { name: "Transaction History" })).toBeVisible();

    // The list (or its empty-state) must be present — not the "connect wallet" gate.
    await expect(page.getByText("Connect your wallet to view your payments")).not.toBeVisible();
  }
);

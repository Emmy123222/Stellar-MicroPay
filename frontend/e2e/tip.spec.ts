/**
 * E2E tests for creator public tip page /tip/[username] (issue #545).
 *
 * Scenarios:
 *  1. Visiting a creator's tip page shows profile info and preset tip amounts ($1, $5, $20).
 *  2. Selecting a preset amount updates the selected tip value.
 *  3. Selecting a preset amount and sending with a connected wallet shows success confirmation.
 *  4. Visiting an un-registered creator's username displays a creator-not-found message.
 */
import { test as base, expect } from "@playwright/test";
import { test as authenticatedTest } from "./fixtures";

const MOCK_CREATOR = {
  username: "alice",
  publicKey: "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV",
};

base.describe("tip page - disconnected", () => {
  base.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).freighter = {
        isConnected: async () => ({ isConnected: false }),
        getPublicKey: async () => ({ publicKey: "" }),
        signTransaction: async () => ({ signedTransaction: "" }),
        requestAccess: async () => ({}),
        isAllowed: async () => ({ isAllowed: false }),
      };
    });

    // Mock username resolution API endpoint
    await page.route("**/api/accounts/resolve/*", (route) => {
      const url = route.request().url();
      if (url.includes("/alice")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: MOCK_CREATOR,
          }),
        });
      } else {
        route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: "@unknown does not have a public tip page yet.",
          }),
        });
      }
    });
  });

  base.test(
    "visiting a creator tip page shows profile details and preset tip amounts",
    async ({ page }) => {
      await page.goto("/tip/alice");

      // Page title and creator profile heading
      await expect(page.getByRole("heading", { name: "Tip @alice" })).toBeVisible();
      await expect(page.getByText("Public tip page")).toBeVisible();

      // Preset amount buttons should be visible
      await expect(page.getByRole("button", { name: /\$1 tip/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /\$5 tip/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /\$20 tip/i })).toBeVisible();

      // Disconnected state button prompts to connect wallet
      await expect(page.getByRole("button", { name: /Connect wallet to tip/i })).toBeVisible();
    }
  );

  base.test(
    "visiting an unregistered creator shows creator not found message",
    async ({ page }) => {
      await page.goto("/tip/unknown");

      await expect(page.getByRole("heading", { name: "Creator not found" })).toBeVisible();
      await expect(page.getByText("@unknown does not have a public tip page yet.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
    }
  );
});

authenticatedTest.describe("tip page - authenticated send flow", () => {
  authenticatedTest.beforeEach(async ({ page }) => {
    // Mock username resolution API endpoint
    await page.route("**/api/accounts/resolve/*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: MOCK_CREATOR,
        }),
      });
    });

    // Mock tip recording API endpoint
    await page.route("**/api/tips*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, id: "tip_123" }),
      });
    });

    // Mock transaction submission endpoint
    await page.route("**/horizon-testnet.stellar.org/transactions*", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            hash: "mock_tip_tx_hash_987654321",
            ledger: 123457,
            successful: true,
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ _embedded: { records: [] } }),
        });
      }
    });
  });

  authenticatedTest(
    "selecting a preset amount updates amount and sending displays success confirmation",
    async ({ page }) => {
      await page.goto("/tip/alice");

      await expect(page.getByRole("heading", { name: "Tip @alice" })).toBeVisible();

      // Select $5 preset tip (2 XLM)
      const preset5Btn = page.getByRole("button", { name: /\$5 tip/i });
      await preset5Btn.click();

      // Verify selected tip amount updates
      const amountInput = page.locator("#tip-amount");
      await expect(amountInput).toHaveValue("2");

      // Click send tip button
      const sendBtn = page.getByRole("button", {
        name: /Send 2.0000000 XLM|Send 2 XLM|Send.*tip/i,
      });
      await expect(sendBtn).toBeVisible();
      await sendBtn.click();

      // Confirm Payment modal pops up
      await expect(page.getByRole("heading", { name: "Confirm Payment" })).toBeVisible();
      const confirmBtn = page.getByRole("button", { name: "Confirm & Sign" });
      await confirmBtn.click();

      // Verify success confirmation banner is displayed
      await expect(page.getByText("Tip sent to @alice!")).toBeVisible({ timeout: 15_000 });
    }
  );
});

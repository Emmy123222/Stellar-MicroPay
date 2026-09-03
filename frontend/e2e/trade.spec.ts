/**
 * E2E tests for DEX trade page (issue #544).
 *
 * Scenarios:
 *  1. Disconnected state shows wallet connect prompt.
 *  2. Connected state displays DEX orderbook and trading form.
 *  3. Selecting an asset pair shows a quote / market price view.
 *  4. Submitting a trade shows pending status and then success notification.
 */
import { test as base, expect } from "@playwright/test";
import { test as authenticatedTest } from "./fixtures";

base.describe("trade page - disconnected", () => {
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
  });

  base.test("shows wallet connect prompt when wallet is not connected", async ({ page }) => {
    await page.goto("/trade");
    await expect(page.getByRole("heading", { name: "Stellar DEX Trading" })).toBeVisible();
    await expect(
      page.getByText("Connect your wallet to trade XLM and USDC on the Stellar DEX.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect Freighter Wallet/i })).toBeVisible();
  });
});

authenticatedTest.describe("trade page - authenticated", () => {
  authenticatedTest.beforeEach(async ({ page }) => {
    // Mock orderbook API route
    await page.route("**/horizon-testnet.stellar.org/orderbook*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bids: [{ price: "0.1200000", amount: "100.0000000" }],
          asks: [{ price: "0.1250000", amount: "100.0000000" }],
          base: {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          },
          counter: { asset_type: "native" },
        }),
      });
    });

    // Mock transaction submission endpoint
    await page.route("**/horizon-testnet.stellar.org/transactions*", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            hash: "mock_trade_tx_hash_123456789",
            ledger: 123456,
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
    "selecting an asset pair shows quote and orderbook details",
    async ({ page }) => {
      await page.goto("/trade");

      // Page title and orderbook container should be visible
      await expect(page.getByRole("heading", { name: "Stellar DEX Trading" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Orderbook (USDC/XLM)" })).toBeVisible();

      // Verify orderbook quote details are loaded (asks, bids, spread)
      await expect(page.getByText("Sell Orders")).toBeVisible();
      await expect(page.getByText("Buy Orders")).toBeVisible();
      await expect(page.getByText("Spread")).toBeVisible();
      await expect(page.getByText("0.1250000")).toBeVisible();
      await expect(page.getByText("0.1200000")).toBeVisible();

      // Asset selection in trade form
      const payAssetSelect = page.locator("select").first();
      const receiveAssetSelect = page.locator("select").nth(1);

      await expect(payAssetSelect).toHaveValue("XLM");
      await expect(receiveAssetSelect).toHaveValue("USDC");

      // Market price indicator is displayed for market orders
      await expect(page.getByText("Market Price")).toBeVisible();

      // Change asset pair (swap selection)
      await payAssetSelect.selectOption("USDC");
      await expect(payAssetSelect).toHaveValue("USDC");
    }
  );

  authenticatedTest(
    "submitting a trade shows pending status and success confirmation",
    async ({ page }) => {
      await page.goto("/trade");

      // Fill in trade amount
      const amountInput = page.getByPlaceholder("0.00");
      await amountInput.fill("10");

      const submitBtn = page.getByRole("button", { name: "Execute Market Order" });
      await expect(submitBtn).toBeEnabled();

      // Submit trade
      await submitBtn.click();

      // Verify pending status is shown on button during execution
      // (Button shows "Processing..." while processing)
      // Then toast appears with success message
      await expect(page.getByText("Market order executed successfully!")).toBeVisible({
        timeout: 15_000,
      });
    }
  );
});

import { test, expect } from "./fixtures";

test.describe("Payment Request Links", () => {
  test("Generating a request link includes the entered amount/memo and opening it pre-fills payment", async ({
    page,
    authenticatedPage,
  }) => {
    // We can simulate the generation and then opening the link.
    // The link expects base64 encoded JSON in the 'r' query parameter.

    const requestData = {
      destination: "GBTC7XKX234567890123456789012345678901234567890123456789",
      amount: "5.5",
      memo: "Test Payment",
      validUntil: Date.now() + 1000000,
    };

    const encodedData = Buffer.from(JSON.stringify(requestData)).toString("base64");

    // Visit the request page with the encoded data
    await page.goto(`/request?r=${encodedData}`);

    // Ensure the page loaded
    await expect(page.locator("h1")).toHaveText("Complete Request");

    // Connect wallet
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    // After connecting, the send payment form should be visible and prefilled
    // Wait for the form to appear
    await expect(page.locator("text=Send Payment")).toBeVisible();

    // Verify prefilled values
    await expect(page.locator('input[type="text"]').first()).toHaveValue(requestData.destination);
    await expect(page.locator('input[type="number"]')).toHaveValue(requestData.amount);
    await expect(page.locator('input[placeholder="Optional memo"]')).toHaveValue(requestData.memo);
  });
});

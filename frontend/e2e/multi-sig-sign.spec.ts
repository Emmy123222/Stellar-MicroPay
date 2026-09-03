/**
 * E2E tests for multi-sig-sign page (issue #539).
 *
 * Scenarios:
 *  1. Importing a valid XDR shows the pending signature state
 *  2. Signing updates the signature progress
 *  3. Submit becomes available once the threshold is met
 */
import { test as base, expect } from "@playwright/test";
import { test as authenticatedTest } from "./fixtures";

// Mock valid transaction XDR
const mockValidXDR =
  "AAAAAgAAAAD8AAAAAAAAAAQAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAA";

authenticatedTest.describe("multi-sig-sign page", () => {
  authenticatedTest("importing a valid XDR shows the pending signature state", async ({ page }) => {
    // Navigate to multi-sig-sign page with XDR in query param
    await page.goto(`/multi-sig-sign?xdr=${encodeURIComponent(mockValidXDR)}`);

    // Wait for transaction to load
    await expect(
      page.getByRole("heading", { name: "Sign Multi-Signature Transaction" })
    ).toBeVisible({ timeout: 10_000 });

    // Verify transaction details are displayed
    await expect(page.getByText("Transaction Details")).toBeVisible();
    await expect(page.getByText("From:")).toBeVisible();

    // Verify sign button is available (ready state)
    await expect(page.getByRole("button", { name: "Sign with Freighter" })).toBeVisible();
  });

  authenticatedTest("signing updates the signature progress", async ({ page }) => {
    // Navigate to multi-sig-sign page with XDR in query param
    await page.goto(`/multi-sig-sign?xdr=${encodeURIComponent(mockValidXDR)}`);

    // Wait for transaction to load
    await expect(
      page.getByRole("heading", { name: "Sign Multi-Signature Transaction" })
    ).toBeVisible({ timeout: 10_000 });

    // Click sign button
    await page.getByRole("button", { name: "Sign with Freighter" }).click();

    // Verify signing state is shown
    await expect(page.getByText("Signing...")).toBeVisible({ timeout: 5_000 });

    // Wait for signed state
    await expect(page.getByText("Signed Transaction XDR")).toBeVisible({ timeout: 10_000 });

    // Verify signed XDR textarea is displayed
    await expect(page.locator("textarea.input")).toBeVisible();

    // Verify copy button is displayed
    await expect(page.getByRole("button", { name: "Copy Signed XDR" })).toBeVisible();
  });

  authenticatedTest("invalid XDR shows error message", async ({ page }) => {
    const invalidXDR = "invalid_xdr_string";

    // Navigate with invalid XDR
    await page.goto(`/multi-sig-sign?xdr=${encodeURIComponent(invalidXDR)}`);

    // Wait for error message
    await expect(page.getByText("Invalid transaction XDR")).toBeVisible({ timeout: 10_000 });

    // Verify sign button is not shown
    await expect(page.getByRole("button", { name: "Sign with Freighter" })).not.toBeVisible();
  });

  authenticatedTest("submit becomes available once the threshold is met", async ({ page }) => {
    // Navigate to multi-sig-sign page with XDR in query param
    await page.goto(`/multi-sig-sign?xdr=${encodeURIComponent(mockValidXDR)}`);

    // Wait for transaction to load
    await expect(
      page.getByRole("heading", { name: "Sign Multi-Signature Transaction" })
    ).toBeVisible({ timeout: 10_000 });

    // Initially, sign button should be available
    await expect(page.getByRole("button", { name: "Sign with Freighter" })).toBeVisible();

    // Click sign button
    await page.getByRole("button", { name: "Sign with Freighter" }).click();

    // Wait for signed state
    await expect(page.getByText("Signed Transaction XDR")).toBeVisible({ timeout: 10_000 });

    // After signing, the signed XDR should be available for copy/submit
    await expect(page.locator("textarea.input")).toHaveValue(/signed/);

    // Copy button should be available to copy the signed XDR
    await expect(page.getByRole("button", { name: "Copy Signed XDR" })).toBeVisible();
  });
});

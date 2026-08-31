/**
 * E2E tests for settings page (issue #543).
 *
 * Scenarios:
 *  1. Toggling theme in settings persists after a page reload.
 *  2. Other saved preferences (auto dark mode schedule & custom network) persist across navigation and reloads.
 */
import { test, expect } from "@playwright/test";

test.describe("settings page", () => {
  test.beforeEach(async ({ page }) => {
    // Stub Freighter extension
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

  test("settings page loads correctly with heading and sections", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Network Configuration" })).toBeVisible();
  });

  test("toggling theme in settings persists after a page reload", async ({ page }) => {
    await page.goto("/settings");

    const toggleBtn = page.getByRole("button", { name: "Toggle dark mode" });
    await expect(toggleBtn).toBeVisible();

    // Check initial state
    const initialPressed = await toggleBtn.getAttribute("aria-pressed");
    const expectedToggledState = initialPressed === "true" ? "false" : "true";

    // Click to toggle theme
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute("aria-pressed", expectedToggledState);

    // Reload page to verify persistence
    await page.reload();

    const toggleBtnAfterReload = page.getByRole("button", { name: "Toggle dark mode" });
    await expect(toggleBtnAfterReload).toHaveAttribute("aria-pressed", expectedToggledState);
  });

  test("auto dark mode schedule setting persists across navigation", async ({ page }) => {
    await page.goto("/settings");

    const autoToggleBtn = page.getByRole("button", { name: "Toggle automatic dark mode schedule" });
    await expect(autoToggleBtn).toBeVisible();

    // Enable auto schedule
    await autoToggleBtn.click();
    await expect(autoToggleBtn).toHaveAttribute("aria-pressed", "true");

    // Night start/end time pickers should now be visible
    const nightStartInput = page.locator("#night-start");
    await expect(nightStartInput).toBeVisible();
    await nightStartInput.fill("21:00");

    // Navigate to dashboard and back to settings
    await page.goto("/dashboard");
    await page.goto("/settings");

    // Verify preference persisted across navigation
    const autoToggleAfterNav = page.getByRole("button", {
      name: "Toggle automatic dark mode schedule",
    });
    await expect(autoToggleAfterNav).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#night-start")).toHaveValue("21:00");
  });

  test("network configuration preference persists across page reload", async ({ page }) => {
    await page.goto("/settings");

    // Click Custom network button
    const customNetworkBtn = page.getByRole("button", { name: "Custom" });
    await customNetworkBtn.click();

    // Enter custom Horizon URL
    const urlInput = page.getByPlaceholder("https://horizon.example.com");
    await expect(urlInput).toBeVisible();
    await urlInput.fill("https://horizon-custom.stellar.org");
    await urlInput.blur();

    // Reload page and check persistence
    await page.reload();

    const customUrlAfterReload = page.getByPlaceholder("https://horizon.example.com");
    await expect(customUrlAfterReload).toHaveValue("https://horizon-custom.stellar.org");
  });
});

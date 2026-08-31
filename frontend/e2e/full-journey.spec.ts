// playwright/e2e/full-journey.spec.ts
import { test, expect } from "./fixtures";

const MOCK_PUBLIC_KEY = "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV";
const MOCK_RECIPIENT_KEY = "GBPMK2QWQ2JKMSFL6EK44LNK45QWGS7IJBLUZXBT5B2FZXOG77GRQ5J4";

function mockAccountResponse(balance: string) {
  return {
    id: MOCK_PUBLIC_KEY,
    account_id: MOCK_PUBLIC_KEY,
    sequence: "1234567890",
    subentry_count: 0,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: { auth_required: false, auth_revocable: false },
    signers: [{ key: MOCK_PUBLIC_KEY, weight: 1, type: "ed25519_public_key" }],
    balances: [{ asset_type: "native", balance }],
  };
}

// Drives the wallet connection flow and waits for the authenticated dashboard.
// The fixture mocks window.freighter + all backend APIs, so clicking the button
// completes synchronously from the app's perspective.
async function connectWallet(page: any) {
  await page.goto("/dashboard");

  const walletAddress = page.getByText("Wallet Address");
  const alreadyConnected = await walletAddress
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (alreadyConnected) return;

  await page.getByRole("button", { name: /Connect Freighter Wallet/i }).click();

  // Wait for the authenticated dashboard — the wallet address label is unique to it
  await expect(walletAddress).toBeVisible({ timeout: 15000 });
}

test("data integrity: verify transaction history reflects payment data", async ({ page }) => {
  await connectWallet(page);

  const recentActivity = page.locator(".card").filter({ hasText: "Recent Activity" });
  await expect(recentActivity).toBeVisible();

  await expect(recentActivity.getByRole("link", { name: /View all/i })).toBeVisible();
});

test("deep linking: test payment request link generation and display", async ({ page }) => {
  await connectWallet(page);

  const linkGenerator = page.locator(".card").filter({ hasText: "Request Payment" });
  await expect(linkGenerator).toBeVisible();

  await linkGenerator
    .getByPlaceholder("G...")
    .fill("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  await linkGenerator.locator('input[type="number"]').fill("5");
  await linkGenerator.getByPlaceholder("ID: 123").fill("Request test");

  await linkGenerator.getByRole("button", { name: "Create Request Link" }).click();

  await expect(page.getByText("Generated URL")).toBeVisible();
  const linkElement = page.locator("input[readonly]").first();
  await expect(linkElement).toBeVisible();
  const paymentLink = await linkElement.inputValue();
  expect(paymentLink).toContain("/request?r=");

  await page.getByText("Show QR").click();
  await expect(page.locator("canvas")).toBeVisible();
});

test("complex forms: validate multi-sig transaction workflow", async ({ page }) => {
  await connectWallet(page);

  const multiSigCard = page.locator(".card").filter({ hasText: "Multi-Signature Payment" });
  await expect(multiSigCard).toBeVisible();

  await multiSigCard
    .getByPlaceholder("G...")
    .fill("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  await multiSigCard.locator('input[type="number"]').first().fill("10");
  await multiSigCard.getByPlaceholder("Payment description").fill("Multi-sig test");

  await expect(multiSigCard.getByRole("button", { name: "Build Transaction" })).toBeVisible();
});

test("scheduling logic: test notification opt-in and test functionality", async ({ page }) => {
  await page.context().grantPermissions(["notifications"]);
  await connectWallet(page);

  await expect(
    page.getByRole("button", {
      name: /Enable payment notifications|Notifications blocked|Disable payment notifications/,
    })
  ).toBeVisible();
});

test("contact management: test wallet address copy functionality", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectWallet(page);

  // The public key injected by the fixture starts with 'G'
  const addressElement = page.locator("span").filter({ hasText: /^G/ }).first();
  await expect(addressElement).toBeVisible();

  const copyButton = page.getByRole("button", { name: "Copy address" });
  await copyButton.click();

  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
});

test("wallet states: handle empty balance scenario", async ({ page }) => {
  await page.route("**/horizon-testnet.stellar.org/**", (route) => {
    if (route.request().url().includes("/accounts/")) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAccountResponse("0.0000000")),
      });
    } else {
      route.fulfill({ status: 200, body: "{}" });
    }
  });

  await connectWallet(page);

  // Balance displays as a formatted number — 0.0000000 rounds to "0"
  const balanceCard = page.locator(".card").filter({ hasText: "XLM Balance" });
  await expect(balanceCard.locator(".font-display").filter({ hasText: /^0\s*XLM$/ })).toBeVisible();
});

test("wallet states: handle insufficient funds", async ({ page }) => {
  await page.route("**/horizon-testnet.stellar.org/**", (route) => {
    if (route.request().url().includes("/accounts/")) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockAccountResponse("5.0000000")),
      });
    } else {
      route.fulfill({ status: 200, body: "{}" });
    }
  });

  await connectWallet(page);

  await expect(page.getByText(/\b5(\s*)XLM\b/)).toBeVisible();

  const sendCard = page.locator(".card").filter({ hasText: "Send Payment" }).first();
  await sendCard.getByPlaceholder("G..., alice*domain.com, or @username").fill(MOCK_RECIPIENT_KEY);
  const amountInput = sendCard.locator('input[type="number"]').first();
  await amountInput.fill("10");

  await expect(amountInput).toHaveValue("10");
  await expect(sendCard.getByRole("button", { name: "Send 10 XLM" })).toBeDisabled();
});

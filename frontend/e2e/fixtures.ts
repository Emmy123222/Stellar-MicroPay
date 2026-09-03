// playwright/e2e/fixtures.ts
import { test as base, expect } from "@playwright/test";

type WalletState = "authenticated" | "empty_balance" | "insufficient_funds";

export const test = base.extend<{
  walletState: WalletState;
  authenticatedPage: Page;
}>({
  walletState: ["authenticated", { option: true }],

  // Keep authenticatedPage as a typed alias for the already-configured page.
  // This avoids nested test declarations and gives specs an explicit fixture.
  authenticatedPage: async ({ page }, use) => {
    await use(page);
  },

  page: async ({ page, walletState }, use) => {
    // --- Freighter wallet mock ---
    const publicKeyMap: Record<WalletState, string> = {
      authenticated: "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV",
      empty_balance: "GBPMK2QWQ2JKMSFL6EK44LNK45QWGS7IJBLUZXBT5B2FZXOG77GRQ5J4",
      insufficient_funds: "GCFVV3BKTNNXJ46CY2TLAGRYFSP23HKEMP5CJFQU3EBACWSGYRQB5LEE",
    };
    const publicKey = publicKeyMap[walletState];

    // --- Horizon (Stellar network) ---
    await page.route("**/horizon-testnet.stellar.org/**", (route) => {
      const url = route.request().url();
      if (url.includes("/accounts/")) {
        const balance =
          walletState === "empty_balance"
            ? "0.0000000"
            : walletState === "insufficient_funds"
              ? "5.0000000"
              : "100.0000000";
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: publicKey,
            account_id: publicKey,
            sequence: "1234567890",
            subentry_count: 0,
            thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
            flags: { auth_required: false, auth_revocable: false },
            signers: [{ key: publicKey, weight: 1, type: "ed25519_public_key" }],
            balances: [{ asset_type: "native", balance }],
          }),
        });
      } else if (url.includes("/transactions")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ _embedded: { records: [] } }),
        });
      } else if (url.includes("/fee_stats")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            last_ledger: "12345678",
            last_ledger_base_fee: "100",
            fee_charged: {
              max: "1000",
              min: "100",
              mode: "100",
              p10: "100",
              p20: "100",
              p30: "100",
              p40: "100",
              p50: "100",
              p60: "100",
              p70: "100",
              p80: "100",
              p90: "100",
              p95: "200",
              p99: "500",
            },
          }),
        });
      } else {
        route.fulfill({ status: 200, body: "{}" });
      }
    });

    // --- CoinGecko price ---
    await page.route("**/api.coingecko.com/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ stellar: { usd: 0.1 } }),
      });
    });

    // --- Backend payment stats API ---
    await page.route("**/api/payments/**/stats", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            publicKey: "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV",
            totalSentXLM: "0.00",
            totalReceivedXLM: "0.00",
            sentCount: 0,
            receivedCount: 0,
            totalTransactions: 0,
          },
        }),
      });
    });

    // --- Backend auth API mocks ---
    await page.route("**/api/auth**", (route) => {
      if (route.request().method() === "GET") {
        // GET /api/auth?account=... returns challenge transaction
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            transaction: "AAAAAgAAAAD8...mock_challenge_xdr", // mock XDR
          }),
        });
      } else if (route.request().method() === "POST") {
        // POST /api/auth with signed transaction returns JWT
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            token: "mock_jwt_token",
          }),
        });
      }
    });

    await page.addInitScript(
      ({ publicKey }: { publicKey: string }) => {
        (window as any).freighter = true;
        window.addEventListener("message", (event) => {
          const request = event.data;
          if (request?.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") {
            return;
          }

          const response: Record<string, unknown> = {
            source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
            messagedId: request.messageId,
          };

          if (request.type === "REQUEST_ACCESS" || request.type === "REQUEST_PUBLIC_KEY") {
            response.publicKey = publicKey;
          } else if (request.type === "REQUEST_ALLOWED_STATUS") {
            response.isAllowed = true;
          } else if (request.type === "REQUEST_CONNECTION_STATUS") {
            response.isConnected = true;
          } else if (request.type === "SUBMIT_TRANSACTION") {
            response.signedTransaction = `${request.transactionXdr}_signed`;
            response.signerAddress = publicKey;
          }

          setTimeout(() => window.postMessage(response, "*"), 0);
        });

        (window as any).freighterApi = {
          isConnected: async () => ({ isConnected: true }),
          getAddress: async () => ({ address: publicKey }),
          getPublicKey: async () => ({ publicKey }),
          requestAccess: async () => ({ address: publicKey }),
          signTransaction: async (xdr: string) => ({ signedTxXdr: xdr + "_signed" }),
          isAllowed: async () => ({ isAllowed: true }),
        };
      },
      { publicKey }
    );

    await use(page);
  },
});

export { expect };

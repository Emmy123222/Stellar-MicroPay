/**
 * Tests for the balance sparkline chart on the Dashboard.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import Dashboard from "@/pages/dashboard";

jest.mock("next/router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/components/WalletConnect", () => () => <div>Wallet Connect</div>);
jest.mock("@/components/TransactionList", () => () => <div>Transactions</div>);
jest.mock("@/components/Toast", () => () => null);
jest.mock("@/components/QRCodeModal", () => () => null);
jest.mock("@/components/SendPaymentForm", () => ({
  __esModule: true,
  default: () => <div>Send Payment</div>,
}));
jest.mock("@/components/PaymentLinkGenerator", () => () => <div>Payment Link</div>);

const mockGetRecentPaymentsForSparkline = jest.fn();

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn().mockResolvedValue("500.0000000"),
  getUSDCBalance: jest.fn().mockResolvedValue(null),
  fundWithFriendbot: jest.fn(),
  ACCOUNT_NOT_FOUND_ERROR: "ACCOUNT_NOT_FOUND",
  streamPayments: jest.fn(() => jest.fn()),
  isValidStellarAddress: jest.fn().mockReturnValue(true),
  shortenAddress: jest.fn((pk: string) => pk.slice(0, 6)),
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
  getRecentPaymentsForSparkline: (...args: unknown[]) =>
    mockGetRecentPaymentsForSparkline(...args),
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

const PUBLIC_KEY = "GABC1234567890ABCDEF";

function makePayment(
  id: string,
  type: "sent" | "received",
  amount: string
) {
  return {
    id,
    type,
    amount,
    asset: "XLM",
    from: type === "sent" ? PUBLIC_KEY : "GOTHER",
    to: type === "received" ? PUBLIC_KEY : "GOTHER",
    createdAt: new Date().toISOString(),
    transactionHash: `hash${id}`,
  };
}

function setupFetch(statsOk = true) {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("coingecko")) {
      return Promise.resolve({ json: async () => ({ stellar: { usd: 0.3 } }) } as Response);
    }
    if (url.includes("/api/payments/")) {
      return Promise.resolve({
        ok: statsOk,
        json: async () =>
          statsOk
            ? {
                success: true,
                data: {
                  publicKey: PUBLIC_KEY,
                  totalSentXLM: "10.0000000",
                  totalReceivedXLM: "20.0000000",
                  sentCount: 1,
                  receivedCount: 2,
                  totalTransactions: 3,
                },
              }
            : { success: false },
      } as Response);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as jest.Mock;
}

describe("Dashboard balance sparkline", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const stellar = require("@/lib/stellar");
    stellar.getXLMBalance.mockResolvedValue("500.0000000");
    stellar.getUSDCBalance.mockResolvedValue(null);
    stellar.streamPayments.mockImplementation(() => jest.fn());
  });

  it("renders sparkline SVG when transaction history is available", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolvedValue([
      makePayment("1", "received", "10"),
      makePayment("2", "sent", "3"),
      makePayment("3", "received", "5"),
    ]);

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /balance trend/i })).toBeInTheDocument();
    });
  });

  it("shows upward trend label when net balance increases", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolvedValue([
      makePayment("1", "received", "10"),
      makePayment("2", "received", "5"),
    ]);

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/upward trend/i)).toBeInTheDocument();
    });
  });

  it("shows downward trend label when net balance decreases", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolvedValue([
      makePayment("1", "sent", "10"),
      makePayment("2", "sent", "5"),
    ]);

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/downward trend/i)).toBeInTheDocument();
    });
  });

  it("does not render sparkline when there are no transactions", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolvedValue([]);

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    // Give time for async effects to settle
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: /balance trend/i })).not.toBeInTheDocument();
    });
  });

  it("renders correctly with fewer than 10 transactions", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolvedValue([
      makePayment("1", "received", "2"),
      makePayment("2", "sent", "1"),
    ]);

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /balance trend/i })).toBeInTheDocument();
    });
  });

  it("does not crash when sparkline fetch fails", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockRejectedValue(new Error("Network error"));

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    // Should still render the balance without sparkline
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: /balance trend/i })).not.toBeInTheDocument();
    });
  });
});

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import Dashboard from "@/pages/dashboard";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), query: {} }),
}));

const mockUseWallet = jest.fn();
jest.mock("@/lib/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("@/components/WalletConnect", () => () => <div>Wallet Connect</div>);
jest.mock("@/components/TransactionList", () => () => <div>Transactions</div>);
jest.mock("@/components/Toast", () => () => null);
jest.mock("@/components/QRCodeModal", () => () => null);
jest.mock("@/components/BatchPaymentForm", () => () => <div>Batch Payment</div>);
jest.mock("@/components/MultiSigFlow", () => () => <div>Multi Sig</div>);
jest.mock("@/components/CreatorTipsDashboard", () => () => <div>Creator Tips</div>);
jest.mock("@/components/OnboardingTour", () => () => null);
jest.mock("@/components/AIPaymentAssistant", () => () => null);
jest.mock("@/components/ExternalPaymentBanner", () => () => null);
jest.mock("@/pages/PaymentRequestGenerator", () => () => <div>Payment Request</div>);
jest.mock("@/components/SendPaymentForm", () => ({
  __esModule: true,
  default: () => <div>Send Payment</div>,
}));

const mockGetRecentPaymentsForSparkline = jest.fn();

jest.mock("@/lib/stellar", () => ({
  getBalances: jest.fn().mockResolvedValue([{ asset: "native", balance: "500.0000000", assetCode: "XLM" }]),
  getXLMBalance: jest.fn().mockResolvedValue("500.0000000"),
  getAccountReserveInfo: jest.fn().mockResolvedValue(null),
  getUSDCBalance: jest.fn().mockResolvedValue(null),
  getRecentPaymentsForStats: jest.fn().mockResolvedValue([]),
  getRecentPaymentsForSparkline: (...args: unknown[]) =>
    mockGetRecentPaymentsForSparkline(...args),
  fetchAllPayments: jest.fn().mockResolvedValue([]),
  getPaymentHistory: jest.fn().mockResolvedValue({ records: [], hasMore: false }),
  getFriendBotFunding: jest.fn(),
  waitForAccountFunding: jest.fn().mockResolvedValue(true),
  ACCOUNT_NOT_FOUND_ERROR: "ACCOUNT_NOT_FOUND",
  streamPayments: jest.fn(() => jest.fn()),
  isValidStellarAddress: jest.fn().mockReturnValue(true),
  shortenAddress: jest.fn((pk: string) => pk.slice(0, 6)),
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
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
      return Promise.resolve({
        ok: true,
        json: async () => ({ stellar: { usd: 0.3 } }),
      } as Response);
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

    if (url.includes("/api/accounts/resolve/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as jest.Mock;
}

describe("Dashboard balance sparkline", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({
      publicKey: PUBLIC_KEY,
      connectWallet: jest.fn(),
      disconnectWallet: jest.fn(),
      isWalletReady: true,
    });
  });

  it("renders sparkline SVG when transaction history is available", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolvedValue([
      makePayment("1", "received", "10"),
      makePayment("2", "sent", "3"),
      makePayment("3", "received", "5"),
    ]);

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /balance trend/i })).toBeInTheDocument();
    });
  });

  it("shows upward trend label when net balance increases", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolvedValue([
      makePayment("1", "received", "5"),
      makePayment("2", "received", "10"),
    ]);

    render(<Dashboard />);

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

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText(/downward trend/i)).toBeInTheDocument();
    });
  });

  it("does not render sparkline when there are no transactions", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolvedValue([]);

    render(<Dashboard />);

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

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /balance trend/i })).toBeInTheDocument();
    });
  });

  it("does not crash when sparkline fetch fails", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockRejectedValue(new Error("Network error"));

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByRole("img", { name: /balance trend/i })).not.toBeInTheDocument();
    });
  });
});

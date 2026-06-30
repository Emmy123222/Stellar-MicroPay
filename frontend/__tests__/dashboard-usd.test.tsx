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

jest.mock("@/lib/stellar", () => ({
  getBalances: jest.fn().mockResolvedValue([{ asset: "native", balance: "500.0000000", assetCode: "XLM" }]),
  getXLMBalance: jest.fn().mockResolvedValue("500.0000000"),
  getAccountReserveInfo: jest.fn().mockResolvedValue(null),
  getUSDCBalance: jest.fn().mockResolvedValue(null),
  getRecentPaymentsForStats: jest.fn().mockResolvedValue([]),
  getRecentPaymentsForSparkline: jest.fn().mockResolvedValue([]),
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

function mockDashboardFetch(
  coinGeckoResponse: Promise<Response>
): jest.Mock {
  return jest.fn((input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("coingecko")) {
      return coinGeckoResponse;
    }

    if (url.includes("/api/payments/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            publicKey: PUBLIC_KEY,
            totalSentXLM: "10.0000000",
            totalReceivedXLM: "20.0000000",
            sentCount: 1,
            receivedCount: 2,
            totalTransactions: 3,
          },
        }),
      } as Response);
    }

    if (url.includes("/api/accounts/resolve/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe("Dashboard USD price display", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({
      publicKey: PUBLIC_KEY,
      connectWallet: jest.fn(),
      disconnectWallet: jest.fn(),
      isWalletReady: true,
    });
  });

  it("shows USD equivalent when CoinGecko responds", async () => {
    global.fetch = mockDashboardFetch(
      Promise.resolve({
        ok: true,
        json: async () => ({ stellar: { usd: 0.3 } }),
      } as Response)
    );

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText("≈ $150.00 USD")).toBeInTheDocument();
    });
  });

  it("hides USD line when CoinGecko fails", async () => {
    global.fetch = mockDashboardFetch(
      Promise.reject(new Error("Network error"))
    );

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText(/≈ \$/)).not.toBeInTheDocument();
    });
  });

  it("hides USD line when the API returns an unexpected shape", async () => {
    global.fetch = mockDashboardFetch(
      Promise.resolve({
        ok: true,
        json: async () => ({}),
      } as Response)
    );

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText(/≈ \$/)).not.toBeInTheDocument();
    });
  });
});

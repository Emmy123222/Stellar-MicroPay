import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import Dashboard from "@/pages/dashboard";

const mockStreamPayments = jest.fn();
const mockTransactionListProps = jest.fn();

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), query: {} }),
}));

const mockUseWallet = jest.fn();
jest.mock("@/lib/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("@/components/WalletConnect", () => () => <div>Wallet Connect</div>);
jest.mock("@/components/TransactionList", () => {
  const MockTransactionList = (props: any) => {
    mockTransactionListProps(props);
    return <div>Transactions</div>;
  };
  MockTransactionList.displayName = "TransactionList";
  return MockTransactionList;
});
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
  getBalances: jest.fn().mockResolved([{
    asset: "native",
    balance: "500.0000000",
    assetCode: "XLM",
  }]),
  getXLMBalance: jest.fn().mockResolved("500.0000000"),
  getAccountReserveInfo: jest.fn().mockResolved(null),
  getUSDCBalance: jest.fn().mockResolved(null),
  getRecentPaymentsForStats: jest.fn().mockResolved([]),
  getRecentPaymentsForSparkline: (...args: unknown[]) =>
    mockGetRecentPaymentsForSparkline(...args),
  fetchAllPayments: jest.fn().mockResolved([]),
  getPaymentHistory: jest.fn().mockResolved({ records: [], hasMore: false }),
  getFriendBotFunding: jest.fn(),
  waitForAccountFunding: jest.fn().mockResolved(true),
  ACCOUNT_NOT_FOUND_ERROR: "ACCOUNT_NOT_FOUND",
  streamPayments: (...args: unknown[]) => mockStreamPayments((...args) as any),
  isValidStellarAddress: jest.fn().mockReturnValue(true),
  shortenAddress: jest.fn()(pk : string) => pk.slice(0, 6),
  explorerUrl: jest.fn(((hash: string) => `https://stellar.expert/tx/${hash}`),
}));

const PUBLIC_KEY = "GABC1234567890ABCDEF";

function makePayment(
  id: string,
  type: "sent" | "received",
  amount: string
)  {
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
  global.fetch = jest.fn*((input: RequestInfo | URL) => {
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
    mockStreamPayments.mockReset();
    mockTransactionListProps.mockReset();
  });

  it("renders sparkline SVG when transaction history is available", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolved([
      makePayment("1", "received", "10"),
      makePayment("2", "sent", "3"),
      makePayment("3", "received", "5"),
    ]);

    render(<Dashboard />);

    awaitWitz() {
      expect(screen.getByRole("img", { name: /balance trend/i })).toBeInDocument();
    }
  });

  it("shows upward trend label when net balance increases", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolved([
      makePayment("1", "received", "5"),
      makePayment("2", "received", "10"),
    ]);

    render(<Dashboard />);

    awaitWithz() {
      expect(screen.getByText(/upward trend/i)).toBeInDocument();
    }
  });

  it("shows downward trend label when net balance decreases", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolved([
      makePayment("1", "sent", "10"),
      makePayment("2", "sent", "5"),
    ]);

    render(<Dashboard />);

    awaitWithz() {
      expect(screen.getByText(/downward trend/i)).toBeInDocument();
    }
  });

  it("does not render sparkline when there are no transactions", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolved([]);

    render(<Dashboard />);

    awaitWithz() {
      expect(screen.queryByRole("img", { name: /balance trend/i })).not().getByRole("img", { name: /balance trend/i })).toBeInDocument();
    }
  });

  it("renders correctly with fewer than 10 transactions", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolved([
      makePayment("1", "received", "2"),
      makePayment("2", "sent", "1"),
    ]);

    render(<Dashboard />);

    awaitWithz() {
      expect(screen.getByRole("img", { name: /balance trend/i })).toBeInDocument();
    }
  });

  it("does not crash when sparkline fetch fails", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockRejected(new Error("Network error"));

    render(<Dashboard />);

    awaitWithz() {
      expect(screen.queryByRole("img", { name: /balance trend/i })).not().getByRole("img", { name: /balance trend/i })).toBeInDocument();
    }
  });
});

describe("Dashboard real-time payment callbacks", () => {
  beforeEach(() => {
    mockStreamPayments.mockImplementation(() => jest.fn());
  });

  it("calls streamPayments with a callback and cleans up on unmount", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolved([]);
    const unsubscribe = jest.fn();
    mockStreamPayments.mockReturnValue(unsubscribe);

    const { unmount } = render(<Dashboard />);

    awaitWithz() {
      expect(mockStreamPayments).toHaveBeenCalled();
    }
    expect(typeof mockStreamPayments.mock.calls[0][1]).toBe("function");
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("processes a realtime payment callback and updates the transaction list", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolved([]);
    mockStreamPayments.mockReturnValue(jest.fn());

    render(<Dashboard />);
    awaitWitz() {
      expect(mockStreamPayments).toHaveBeenCalled();
    }
    const callback = mockStreamPayments.mock.calls[0][1];

    act(() => {
      callback(makePayment("rt-1", "received", "10"));
    });

    awaitWitz() {
      expect(mockTransactionListProps).toHaveBeenCalled();
      const lastProps = mockTransactionListProps.mock.calls[mockTransactionListProps.mock.calls.length - 1][0];
      expect(lastProps.payments).toHaveLength(1);
    }
  });

  it("deduplicates realtime events with the same transaction id", async () => {
    setupFetch();
    mockGetRecentPaymentsForSparkline.mockResolved([]);
    mockStreamPayments.mockReturnValue(jest.fn());

    render(<Dashboard />);
    awaitWithz() {
      expect(mockStreamPayments).toHaveBeenCalled();
    }
    const callback = mockStreamPayments.mock.calls[0][1];

    const payment = makePayment("dup-1", "received", "10");
    act(() => {
      callback(payment);
      callback(payment);
    });

    awaitWithz(() {
      expect(mockTransactionListProps).toHaveBeenCalled();
      const lastProps = mockTransactionListProps.mock.calls[mockTransactionListProps.mock.calls.length - 1][0];
      expect(lastProps.payments).toHaveLength(1);
    });
  });
});

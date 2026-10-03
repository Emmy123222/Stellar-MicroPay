import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
jest.mock("@/components/LiveEventsFeed", () => ({
  __esModule: true,
  default: () => <div data-testid="live-events-feed">Live feed</div>,
}));
jest.mock("@/pages/PaymentRequestGenerator", () => () => <div>Payment Request</div>);
jest.mock("@/components/SendPaymentForm", () => ({
  __esModule: true,
  default: () => <div>Send Payment</div>,
}));

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn().mockResolvedValue("500.0000000"),
  getAccountReserveInfo: jest.fn().mockResolvedValue(null),
  getUSDCBalance: jest.fn().mockResolvedValue(null),
  getRecentPaymentsForStats: jest.fn().mockResolvedValue([]),
  getRecentPaymentsForSparkline: jest.fn().mockResolvedValue([]),
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

function setupFetch() {
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
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);
    }

    if (url.includes("/api/accounts/resolve/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);
    }

    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  }) as jest.Mock;
}

describe("Dashboard tabs", () => {
  beforeEach(() => {
    setupFetch();
    mockUseWallet.mockReturnValue({
      publicKey: PUBLIC_KEY,
      connectWallet: jest.fn(),
      disconnectWallet: jest.fn(),
      isWalletReady: true,
    });
  });

  it("opens on the Overview tab with the overview panel visible", async () => {
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const eventsTab = screen.getByRole("tab", { name: "Live Events" });

    expect(overviewTab).toHaveAttribute("aria-selected", "true");
    expect(eventsTab).toHaveAttribute("aria-selected", "false");

    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveAttribute("id", "dashboard-panel-overview");
    expect(panels[0]).not.toHaveAttribute("hidden");
  });

  it("switches to the Live Events panel when its tab is activated", async () => {
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Live Events" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("tab", { name: "Live Events" }));

    expect(screen.getByRole("tab", { name: "Live Events" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "false"
    );

    // The active panel is exposed; the hidden overview panel is not.
    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveAttribute("id", "dashboard-panel-events");

    await waitFor(() => {
      expect(screen.getByTestId("live-events-feed")).toBeInTheDocument();
    });
  });
});

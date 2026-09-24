import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n";
import { I18nProvider } from "@/contexts/I18nContext";
import Dashboard from "@/pages/dashboard";

const mockUseWallet = jest.fn();

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), query: {} }),
}));

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

function setupFetch() {
  global.fetch = jest.fn(
    async () => ({ ok: true, json: async () => ({}) }) as Response
  ) as unknown as typeof fetch;
}

describe("Dashboard internationalisation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setupFetch();
    mockUseWallet.mockReturnValue({
      publicKey: "GABC1234567890ABCDEF",
      connectWallet: jest.fn(),
      disconnectWallet: jest.fn(),
      isWalletReady: true,
    });
  });

  it("renders English by default", async () => {
    render(<Dashboard />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Dashboard" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Send and receive XLM globally")
    ).toBeInTheDocument();
    expect(screen.queryByText("Panel")).not.toBeInTheDocument();
  });

  it("renders Spanish when the stored locale is es", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "es");

    render(
      <I18nProvider>
        <Dashboard />
      </I18nProvider>
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Panel" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Envía y recibe XLM en todo el mundo")
    ).toBeInTheDocument();
    expect(screen.getByText("Dirección de la cartera")).toBeInTheDocument();
    expect(screen.getByText("Saldo XLM")).toBeInTheDocument();
    expect(screen.getByText("Actividad reciente")).toBeInTheDocument();
    // The tab strip introduced by the stacked events branch is translated too.
    expect(
      screen.getByRole("tab", { name: "Resumen" })
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "Eventos en vivo" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Send and receive XLM globally")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Recent Activity")).not.toBeInTheDocument();
  });
});

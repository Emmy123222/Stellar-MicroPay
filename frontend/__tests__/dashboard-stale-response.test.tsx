import React from "react";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import Dashboard from "@/pages/dashboard";
import * as stellarLib from "@/lib/stellar";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), query: {} }),
}));

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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
  getBalances: jest.fn(),
  getXLMBalance: jest.fn(),
  getAccountReserveInfo: jest.fn().mockResolvedValue(null),
  getRecentPaymentsForStats: jest.fn().mockResolvedValue([]),
  getRecentPaymentsForSparkline: jest.fn().mockResolvedValue([]),
  fetchAllPayments: jest.fn().mockResolvedValue([]),
  ACCOUNT_NOT_FOUND_ERROR: "ACCOUNT_NOT_FOUND",
}));

describe("Dashboard stale response handling (#739)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as any)
    );
  });

  it("discards balance response if account or network changes while request is in flight", async () => {
    let resolveFirstBalance: (val: any) => void = () => {};
    let resolveSecondBalance: (val: any) => void = () => {};

    const firstPromise = new Promise<any>((resolve) => {
      resolveFirstBalance = resolve;
    });

    const secondPromise = new Promise<any>((resolve) => {
      resolveSecondBalance = resolve;
    });

    (stellarLib.getBalances as jest.Mock)
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => secondPromise);

    // Initial render with Account A on Testnet
    mockUseWallet.mockReturnValue({
      publicKey: "GACCOUNT_A_TESTNET",
      network: "testnet",
    });

    const { rerender } = render(<Dashboard />);

    // Rapid switch to Account B on Mainnet before first request resolves
    mockUseWallet.mockReturnValue({
      publicKey: "GACCOUNT_B_MAINNET",
      network: "mainnet",
    });

    rerender(<Dashboard />);

    // Resolve first (stale) response with 100 XLM for Account A
    resolveFirstBalance([{ assetCode: "XLM", balance: "100.0000000", asset: "native" }]);

    // Resolve second (latest) response with 500 XLM for Account B
    resolveSecondBalance([{ assetCode: "XLM", balance: "500.0000000", asset: "native" }]);

    await waitFor(() => {
      expect(stellarLib.getBalances).toHaveBeenCalledTimes(2);
    });
  });
});

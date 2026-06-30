/**
 * __tests__/snapshots.test.tsx
 * Snapshot tests for key UI components and pages — resolves #296.
 * Catches unintended UI regressions in CI.
 */

import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";

// ─── Mocks (must be declared before imports) ──────────────────────────────────

// Mock fetch globally (used by Dashboard for CoinGecko price)
global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ stellar: { usd: 0.12 } }),
  } as Response)
);

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/",
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    query: {},
  }),
}));

jest.mock("next/link", () => {
  const Link = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  Link.displayName = "Link";
  return Link;
});

jest.mock("next/head", () => {
  const Head = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Head.displayName = "Head";
  return Head;
});

jest.mock("next/dynamic", () => {
  return () => {
    const Comp = () => null;
    Comp.displayName = "DynamicComponent";
    return Comp;
  };
});

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn(),
  buildSorobanTipTransaction: jest.fn(),
  buildReceiptMintTransaction: jest.fn(),
  CONTRACT_ID: null,
  explorerUrl: jest.fn((hash: string) => `https://expert.stellar.org/tx/${hash}`),
  isValidStellarAddress: jest.fn((addr: string) => addr.startsWith("G") && addr.length === 56),
  submitTransaction: jest.fn(),
  getNetworkConfig: jest.fn(() => ({ network: "testnet", horizonUrl: "https://horizon-testnet.stellar.org" })),
  fetchNetworkFeeStats: jest.fn(() => Promise.resolve({ baseFeeXlm: 0.00001, feeLevel: "normal" })),
  getBalances: jest.fn(() => Promise.resolve([{ asset: "native", balance: "100.0000000", assetCode: "XLM" }])),
  getPaymentHistory: jest.fn(() => Promise.resolve({ payments: [], hasMore: false })),
  getXLMBalance: jest.fn(() => Promise.resolve("100.0000000")),
  getUSDCBalance: jest.fn(() => Promise.resolve(null)),
  getAccountReserveInfo: jest.fn(() => Promise.resolve({ subentryCount: 0, minimumBalance: 1 })),
  getRecentPaymentsForSparkline: jest.fn(() => Promise.resolve([])),
  getRecentPaymentsForStats: jest.fn(() => Promise.resolve([])),
  fetchAllPayments: jest.fn(() => Promise.resolve([])),
  getFriendBotFunding: jest.fn(),
  waitForAccountFunding: jest.fn(() => Promise.resolve(true)),
  shortenAddress: jest.fn((addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`),
  STELLAR_BASE_FEE_XLM: 0.00001,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  truncateMemoText: jest.fn((t: string) => t),
  NETWORK: "testnet",
  server: {
    loadAccount: jest.fn(() => Promise.resolve({})),
    transactions: jest.fn(() => ({ transaction: jest.fn(() => ({ call: jest.fn() })) })),
  },
}));

jest.mock("@/lib/wallet", () => ({
  connectWallet: jest.fn(),
  isFreighterInstalled: jest.fn(() => Promise.resolve(true)),
  detectBrowser: jest.fn(() => "chrome"),
  EXTENSION_URLS: { chrome: "", firefox: "" },
  performSEP0010Auth: jest.fn(() => Promise.resolve({ error: null })),
  getLedgerPublicKey: jest.fn(),
  isLedgerSupported: jest.fn(() => Promise.resolve(false)),
  signTransactionWithWallet: jest.fn(),
}));

jest.mock("@/lib/useWallet", () => ({
  useWallet: () => ({
    publicKey: null,
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
    xlmBalance: "0.0000000",
    usdcBalance: null,
  }),
  WalletProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/pages/_app", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

jest.mock("@/utils/format", () => ({
  formatXLM: jest.fn((n: number | string) => `${parseFloat(String(n)).toFixed(7)} XLM`),
  formatUSD: jest.fn((n: number | string) => `$${parseFloat(String(n)).toFixed(2)}`),
  formatAsset: jest.fn((amount: string, asset: string) => `${amount} ${asset}`),
  shortenAddress: jest.fn((addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`),
  timeAgo: jest.fn(() => "2 min ago"),
  copyToClipboard: jest.fn(),
  exportToCSV: jest.fn(),
  exportToJSON: jest.fn(),
  formatDate: jest.fn(() => "2026-01-01"),
}));

// ─── Component imports ────────────────────────────────────────────────────────

import Navbar from "@/components/Navbar";
import WalletConnect from "@/components/WalletConnect";
import SendPaymentForm from "@/components/SendPaymentForm";
import TransactionList from "@/components/TransactionList";
import Home from "@/pages/index";
import Dashboard from "@/pages/dashboard";
import Transactions from "@/pages/transactions";

// ─── Navbar ───────────────────────────────────────────────────────────────────

describe("Navbar snapshot", () => {
  it("renders disconnected state", () => {
    const { container } = render(<Navbar />);
    expect(container).toMatchSnapshot();
  });
});

// ─── WalletConnect ────────────────────────────────────────────────────────────

describe("WalletConnect snapshot", () => {
  it("renders wallet selection screen", () => {
    const { container } = render(<WalletConnect />);
    expect(container).toMatchSnapshot();
  });
});

// ─── SendPaymentForm ──────────────────────────────────────────────────────────

describe("SendPaymentForm snapshot", () => {
  it("renders idle state", () => {
    const { container } = render(
      <SendPaymentForm
        publicKey="GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ"
        xlmBalance="100.0000000"
        usdcBalance="50.0000000"
      />
    );
    expect(container).toMatchSnapshot();
  });
});

// ─── TransactionList ──────────────────────────────────────────────────────────

describe("TransactionList snapshot", () => {
  it("renders empty state", () => {
    const { container } = render(
      <TransactionList
        publicKey="GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ"
      />
    );
    expect(container).toMatchSnapshot();
  });
});

// ─── Pages ────────────────────────────────────────────────────────────────────

describe("Home page snapshot", () => {
  it("renders landing page", () => {
    const { container } = render(<Home />);
    expect(container).toMatchSnapshot();
  });
});

describe("Dashboard page snapshot", () => {
  it("renders unauthenticated state", () => {
    const { container } = render(<Dashboard />);
    expect(container).toMatchSnapshot();
  });
});

describe("Transactions page snapshot", () => {
  it("renders unauthenticated state", () => {
    const { container } = render(<Transactions />);
    expect(container).toMatchSnapshot();
  });
});

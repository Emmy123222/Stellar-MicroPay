import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import Dashboard from "@/pages/dashboard";

jest.mock("next/router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock("@/components/WalletConnect", () => () => <div>Wallet Connect</div>);
jest.mock("@/components/TransactionList", () => () => <div>Transactions</div>);
jest.mock("@/components/Toast", () => () => null);
jest.mock("@/components/QRCodeModal", () => () => null);
jest.mock("@/components/SendPaymentForm", () => ({
  __esModule: true,
  default: ({ onSuccess }: { onSuccess?: () => void }) => (
    <button onClick={() => onSuccess?.()}>Mock send payment success</button>
  ),
}));

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn().mockResolvedValue("500.0000000"),
  getUSDCBalance: jest.fn().mockResolvedValue(null),
  fundWithFriendbot: jest.fn(),
  ACCOUNT_NOT_FOUND_ERROR: "ACCOUNT_NOT_FOUND",
  streamPayments: jest.fn(() => jest.fn()),
}));

const PUBLIC_KEY = "GABC1234567890ABCDEF";

function jsonResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => data,
  } as Response);
}

describe("Dashboard payment stats widget", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";

    const stellar = require("@/lib/stellar");
    stellar.getXLMBalance.mockResolvedValue("500.0000000");
    stellar.getUSDCBalance.mockResolvedValue(null);
    stellar.streamPayments.mockImplementation(() => jest.fn());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows a loading skeleton then renders formatted stats", async () => {
    let resolveStats!: (value: Response) => void;
    const statsPromise = new Promise<Response>((resolve) => {
      resolveStats = resolve;
    });

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("coingecko")) {
        return jsonResponse({ stellar: { usd: 0.3 } });
      }

      if (url.includes("/api/payments/")) {
        return statsPromise;
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as jest.Mock;

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    expect(screen.getByText("Loading payment stats")).toBeInTheDocument();

    resolveStats(
      {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            publicKey: PUBLIC_KEY,
            totalSentXLM: "142.5000000",
            totalReceivedXLM: "67.0000000",
            sentCount: 4,
            receivedCount: 3,
            totalTransactions: 7,
          },
        }),
      } as Response
    );

    await waitFor(() => {
      expect(screen.getByText("142.50 XLM sent")).toBeInTheDocument();
    });

    expect(screen.getByText("67.00 XLM received")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("4 outgoing payments")).toBeInTheDocument();
    expect(screen.getByText("3 incoming payments")).toBeInTheDocument();
  });

  it("handles stats errors gracefully and retries successfully", async () => {
    let statsCalls = 0;

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("coingecko")) {
        return jsonResponse({ stellar: { usd: 0.3 } });
      }

      if (url.includes("/api/payments/")) {
        statsCalls += 1;

        if (statsCalls === 1) {
          return jsonResponse({ success: false }, false);
        }

        return jsonResponse({
          success: true,
          data: {
            publicKey: PUBLIC_KEY,
            totalSentXLM: "10.0000000",
            totalReceivedXLM: "5.2500000",
            sentCount: 1,
            receivedCount: 2,
            totalTransactions: 3,
          },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as jest.Mock;

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Could not load your payment stats.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("10.00 XLM sent")).toBeInTheDocument();
    });
  });

  it("refreshes the widget after a new payment succeeds", async () => {
    jest.useFakeTimers();

    let statsCalls = 0;

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("coingecko")) {
        return jsonResponse({ stellar: { usd: 0.3 } });
      }

      if (url.includes("/api/payments/")) {
        statsCalls += 1;

        return jsonResponse({
          success: true,
          data: {
            publicKey: PUBLIC_KEY,
            totalSentXLM: statsCalls === 1 ? "12.5000000" : "20.0000000",
            totalReceivedXLM: "3.0000000",
            sentCount: statsCalls === 1 ? 2 : 3,
            receivedCount: 1,
            totalTransactions: statsCalls === 1 ? 3 : 4,
          },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as jest.Mock;

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("12.50 XLM sent")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Mock send payment success" }));

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByText("20.00 XLM sent")).toBeInTheDocument();
    });
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

/**
 * Tests for XLM/USD price fetch and display on the Dashboard.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import Dashboard from "@/pages/dashboard";

// Mock next/router
jest.mock("next/router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

// Mock stellar lib — we only care about the price display
jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn().mockResolvedValue("500.0000000"),
  getUSDCBalance: jest.fn().mockResolvedValue(null),
  fundWithFriendbot: jest.fn(),
  ACCOUNT_NOT_FOUND_ERROR: "ACCOUNT_NOT_FOUND",
  streamPayments: jest.fn(() => jest.fn()),
  isValidStellarAddress: jest.fn().mockReturnValue(true),
  shortenAddress: jest.fn((pk: string) => pk.slice(0, 6)),
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/tx/${hash}`),
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

const PUBLIC_KEY = "GABC1234567890ABCDEF";

describe("Dashboard USD price display", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Re-apply stable mocks after reset
    const stellar = require("@/lib/stellar");
    stellar.getXLMBalance.mockResolvedValue("500.0000000");
    stellar.getUSDCBalance.mockResolvedValue(null);
    stellar.streamPayments.mockImplementation(() => jest.fn());
    stellar.isValidStellarAddress.mockReturnValue(true);
    stellar.shortenAddress.mockImplementation((pk: string) => pk.slice(0, 6));
  });

  it("shows USD equivalent when CoinGecko responds", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ stellar: { usd: 0.3 } }),
    } as Response);

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    // 500 XLM * $0.30 = $150.00
    await waitFor(() => {
      expect(screen.getByText("≈ $150.00 USD")).toBeInTheDocument();
    });
  });

  it("hides USD line when CoinGecko fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    // Wait for balance to load, then confirm no USD line
    await waitFor(() => {
      expect(screen.queryByText(/≈ \$/)).not.toBeInTheDocument();
    });
  });

  it("hides USD line when API returns unexpected shape", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({}),
    } as Response);

    render(<Dashboard publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText(/≈ \$/)).not.toBeInTheDocument();
    });
  });
});

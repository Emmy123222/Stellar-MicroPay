import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import Navbar from "@/components/Navbar";
import { copyToClipboard } from "@/utils/format";

jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: jest.fn() }),
}));

const mockUseWallet = jest.fn();
jest.mock("@/lib/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("@/pages/_app", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

jest.mock("@/utils/format", () => ({
  ...jest.requireActual("@/utils/format"),
  copyToClipboard: jest.fn(),
}));

jest.mock("@/lib/stellar", () => ({
  shortenAddress: (addr: string) => `${addr.slice(0, 4)}...${addr.slice(-4)}`,
  getNetworkConfig: () => ({ network: "testnet" }),
  fetchNetworkFeeStats: jest.fn().mockResolvedValue({ feeLevel: "normal" }),
}));

describe("Navbar Copy-to-Clipboard (#1050)", () => {
  const PUBLIC_KEY = "GABC1234567890ACCOUNT1234567890";

  beforeEach(() => {
    jest.useFakeTimers();
    (copyToClipboard as jest.Mock).mockResolvedValue(true);
    mockUseWallet.mockReturnValue({
      publicKey: PUBLIC_KEY,
      connectWallet: jest.fn(),
      disconnectWallet: jest.fn(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders copy button with accessible aria-label next to shortened address", () => {
    render(<Navbar />);

    expect(screen.getByText("GABC...7890")).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "Copy wallet address" });
    expect(copyButton).toBeInTheDocument();
  });

  it("copies full address to clipboard and shows 'Copied!' tooltip that fades out after 2 seconds", async () => {
    render(<Navbar />);

    const copyButton = screen.getByRole("button", { name: "Copy wallet address" });

    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(copyToClipboard).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(screen.getByText("Copied!")).toBeInTheDocument();

    // Fast-forward 2 seconds
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
  });
});

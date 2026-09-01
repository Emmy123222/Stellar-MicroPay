/**
 * __tests__/settingsSNS.test.tsx
 *
 * Tests for the "Stellar Name Service" section in pages/settings.tsx.
 *
 * Covers:
 *  - Section renders with the expected heading
 *  - Informational copy mentions .xlm names
 *  - Registration link points to stellarnames.org and opens in a new tab
 *  - Known-limitation disclaimer is shown
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// settings.tsx imports from several internal modules; mock the ones that make
// network calls or rely on browser-only state so tests stay deterministic.

jest.mock("@/lib/stellar", () => ({
  getNetworkConfig: jest.fn(() => ({ network: "testnet", horizonUrl: "https://horizon-testnet.stellar.org" })),
  setNetworkConfig: jest.fn(),
  shortenAddress: jest.fn((addr: string) => addr?.slice(0, 6) + "..."),
  server: { loadAccount: jest.fn() },
}));

jest.mock("@/lib/wallet", () => ({
  disconnectWallet: jest.fn(),
  signTransactionWithWallet: jest.fn(),
}));

jest.mock("@/lib/turrets", () => ({
  createTurretsChallenge: jest.fn(),
  deployTurretsFunction: jest.fn(),
  listTurretsFunctions: jest.fn().mockResolvedValue([]),
  pauseTurretsFunction: jest.fn(),
  resumeTurretsFunction: jest.fn(),
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Silence fetch calls during username-fetch effect
global.fetch = jest.fn().mockResolvedValue({
  ok: false,
  json: jest.fn().mockResolvedValue({}),
} as any);

import SettingsPage from "../pages/settings";
import { setNetworkConfig } from "@/lib/stellar";

// ─── Tests ───────────────────────────────────────────────────────────────────

const defaultProps = {
  publicKey: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNN",
  onConnect: jest.fn(),
  onDisconnect: jest.fn(),
};

describe("SettingsPage — Stellar Name Service section", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("associates custom endpoint errors and focuses the first invalid field", () => {
    render(<SettingsPage {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const horizonInput = screen.getByLabelText("Custom Horizon URL");
    fireEvent.change(horizonInput, { target: { value: "http://horizon.example.com" } });
    fireEvent.blur(horizonInput);

    expect(horizonInput).toHaveAttribute("aria-invalid", "true");
    expect(horizonInput).toHaveAttribute("aria-describedby", "custom-horizon-error");
    expect(screen.getByText("Horizon URL must use HTTPS.")).toBeInTheDocument();
    expect(horizonInput).toHaveFocus();
    expect(setNetworkConfig).not.toHaveBeenCalled();
  });

  it("rejects RPC endpoints on a different explicit network", () => {
    render(<SettingsPage {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const horizonInput = screen.getByLabelText("Custom Horizon URL");
    const rpcInput = screen.getByLabelText("Custom Soroban RPC URL");
    fireEvent.change(horizonInput, { target: { value: "https://horizon-testnet.example.com" } });
    fireEvent.change(rpcInput, { target: { value: "https://soroban-mainnet.example.com" } });
    fireEvent.blur(rpcInput);

    expect(rpcInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("RPC URL must use the same network as the Horizon URL.")).toBeInTheDocument();
    expect(rpcInput).toHaveFocus();
    expect(setNetworkConfig).not.toHaveBeenCalled();
  });

  it("renders the 'Stellar Name Service' heading", () => {
    render(<SettingsPage {...defaultProps} />);
    expect(
      screen.getByRole("heading", { name: /Stellar Name Service/i })
    ).toBeInTheDocument();
  });

  it("mentions .xlm names in the description", () => {
    render(<SettingsPage {...defaultProps} />);
    expect(screen.getAllByText(/alice\.xlm/i).length).toBeGreaterThan(0);
  });

  it("provides a link to stellarnames.org", () => {
    render(<SettingsPage {...defaultProps} />);
    const links = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href")?.includes("stellarnames.org"));

    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => {
      expect(link).toHaveAttribute("href", expect.stringContaining("stellarnames.org"));
    });
  });

  it("opens the registration link in a new tab", () => {
    render(<SettingsPage {...defaultProps} />);
    const link = screen
      .getAllByRole("link")
      .find((el) => el.getAttribute("href")?.includes("stellarnames.org") && el.textContent?.includes("Register"));

    expect(link).toBeDefined();
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows the known-limitation disclaimer about stellar.toml", () => {
    render(<SettingsPage {...defaultProps} />);
    // The disclaimer mentions stellar.toml dependency
    expect(screen.getByText(/stellar\.toml/i)).toBeInTheDocument();
  });

  it("shows the user's wallet address in the section when connected", () => {
    render(<SettingsPage {...defaultProps} />);
    // The public key should appear somewhere in the SNS section
    expect(
      screen.getAllByText(/GAAZI4/i).length
    ).toBeGreaterThan(0);
  });

  it("does not render the SNS card inside the mainnet warning modal", () => {
    render(<SettingsPage {...defaultProps} />);
    // The SNS section heading should appear exactly once — as a standalone card
    const headings = screen.getAllByRole("heading", { name: /Stellar Name Service/i });
    expect(headings).toHaveLength(1);
  });
});

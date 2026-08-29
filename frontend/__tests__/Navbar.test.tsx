/**
 * __tests__/Navbar.test.tsx
 * Language selector accessibility: native labels, localized aria-label, selection.
 */

import React from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

jest.mock("@/lib/stellar", () => ({
  getNetworkConfig: jest.fn(() => ({
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  })),
  fetchNetworkFeeStats: jest.fn(() =>
    Promise.resolve({ baseFeeXlm: 0.00001, feeLevel: "normal" })
  ),
  shortenAddress: jest.fn(() => "GA...ABCD"),
}));

jest.mock("@/lib/wallet", () => ({
  connectWallet: jest.fn(),
  performSEP0010Auth: jest.fn(() => Promise.resolve({ error: null })),
}));

jest.mock("@/lib/useWallet", () => ({
  useWallet: () => ({
    publicKey: null,
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
    xlmBalance: "0.0000000",
    usdcBalance: null,
  }),
}));

jest.mock("@/pages/_app", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

const mockUseI18n = jest.fn();

jest.mock("@/contexts/I18nContext", () => ({
  useI18n: () => mockUseI18n(),
}));

const mockSetLocale = jest.fn();

function buildT(callValue: string, selectLanguage: string) {
  const t = jest.fn(() => callValue) as unknown as {
    (): string;
    nav: Record<string, string>;
    common: Record<string, string>;
    dashboard: Record<string, string>;
  };
  t.nav = {
    home: callValue,
    dashboard: callValue,
    trade: callValue,
    transactions: callValue,
    network: callValue,
    settings: callValue,
    connectWallet: callValue,
    disconnect: callValue,
    disconnectConfirm: callValue,
    confirm: callValue,
    cancel: callValue,
  };
  t.common = {
    loading: callValue,
    error: callValue,
    success: callValue,
    copy: callValue,
    copied: callValue,
    selectLanguage,
  };
  t.dashboard = {
    title: callValue,
    balance: callValue,
    available: callValue,
    reserved: callValue,
    send: callValue,
    receive: callValue,
    recentActivity: callValue,
    paymentStats: callValue,
    totalSent: callValue,
    totalReceived: callValue,
    transactionCount: callValue,
  };
  return t;
}

mockUseI18n.mockReturnValue({
  locale: "en",
  setLocale: mockSetLocale,
  t: buildT("Home", "Select language"),
  isRTL: false,
  supportedLocales: ["en", "es"],
});

import Navbar from "@/components/Navbar";

describe("Navbar language selector", () => {
  beforeEach(() => {
    mockSetLocale.mockClear();
    mockUseI18n.mockClear();
    mockUseI18n.mockReturnValue({
      locale: "en",
      setLocale: mockSetLocale,
      t: buildT("Home", "Select language"),
      isRTL: false,
      supportedLocales: ["en", "es"],
    });
  });

  it("lists languages by their native names", () => {
    render(<Navbar />);

    const select = screen.getByRole("combobox", { name: "Select language" });
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["English", "Español"]);
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(["en", "es"]);
  });

  it("calls setLocale with the selected locale", async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Select language" }),
      "es"
    );

    expect(mockSetLocale).toHaveBeenCalledWith("es");
  });

  it("localizes the accessible label from current translations", () => {
    mockUseI18n.mockReturnValue({
      locale: "es",
      setLocale: mockSetLocale,
      t: buildT("Inicio", "Seleccionar idioma"),
      isRTL: false,
      supportedLocales: ["en", "es"],
    });

    render(<Navbar />);
    expect(screen.getByRole("combobox", { name: "Seleccionar idioma" })).toBeInTheDocument();
  });
});

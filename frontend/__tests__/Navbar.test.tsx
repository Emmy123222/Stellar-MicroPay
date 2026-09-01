import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import Navbar from "@/components/Navbar";

jest.mock("next/router", () => ({
  useRouter: jest.fn(() => ({ pathname: "/", push: jest.fn() })),
}));

jest.mock("@/lib/useWallet", () => ({
  useWallet: jest.fn(() => ({
    publicKey: null,
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
  })),
}));

jest.mock("@/pages/_app", () => ({
  useTheme: jest.fn(() => ({ theme: "light", toggleTheme: jest.fn() })),
}));

jest.mock("@/contexts/I18nContext", () => {
  const t = (key: string) => key;
  (t as any).nav = {
    home: "Home",
    dashboard: "Dashboard",
    trade: "Trade",
    transactions: "Transactions",
    network: "Network",
    settings: "Settings",
  };
  return {
    useI18n: jest.fn(() => ({
      locale: "en",
      setLocale: jest.fn(),
      t,
      supportedLocales: ["en"],
    })),
  };
});

describe("Navbar", () => {
  it("renders without crashing", () => {
    render(<Navbar />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
});

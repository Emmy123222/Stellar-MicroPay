/**
 * __tests__/I18nContext.test.tsx
 * Tests for I18nProvider locale state, persistence, and <html lang/dir> sync.
 */

import React from "react";

import { render, screen, act, waitFor } from "@testing-library/react";

import { I18nProvider, useI18n } from "../contexts/I18nContext";
import * as i18n from "../lib/i18n";

// Override only isRTL so the dir=rtl code path can be exercised (no supported
// locale is natively RTL). All other helpers stay real.
jest.mock("../lib/i18n", () => {
  const actual = { ...jest.requireActual("../lib/i18n") };
  return {
    ...actual,
    isRTL: jest.fn((locale: string) => locale === "es"),
  };
});

const mockedIsRTL = i18n.isRTL as jest.Mock;

function Probe() {
  const { locale, setLocale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <button onClick={() => setLocale("es")}>to es</button>
      <button onClick={() => setLocale("en")}>to en</button>
      <button onClick={() => setLocale("fr" as never)}>to unsupported</button>
    </div>
  );
}

describe("I18nProvider", () => {
  beforeEach(() => {
    mockedIsRTL.mockImplementation((locale: string) => locale === "es");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("dir");
    jest.clearAllMocks();
  });

  it("stamps the default locale onto <html> after mount", async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("en"));
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("restores the stored locale on mount and syncs <html>", async () => {
    localStorage.setItem("stellar-micropay:locale", "es");

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("es"));
    expect(document.documentElement.lang).toBe("es");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("updates localStorage and <html lang/dir> on locale change", async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("en"));

    act(() => {
      screen.getByText("to es").click();
    });
    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("es"));
    expect(localStorage.getItem("stellar-micropay:locale")).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    expect(document.documentElement.dir).toBe("rtl");

    act(() => {
      screen.getByText("to en").click();
    });
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    expect(document.documentElement.lang).toBe("en");
  });

  it("rejects unsupported locales without mutating state, storage, or <html>", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("en"));

    act(() => {
      screen.getByText("to unsupported").click();
    });

    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(localStorage.getItem("stellar-micropay:locale")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith("Unsupported locale: fr");
    warnSpy.mockRestore();
  });
});
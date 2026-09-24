import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import en from "@/locales/en.json";
import es from "@/locales/es.json";
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  applyDocumentLocale,
  createTranslator,
  getStoredLocale,
  interpolate,
  isLocale,
  lookupMessage,
  setStoredLocale,
  translate,
} from "@/lib/i18n";
import { I18nProvider, useTranslation } from "@/contexts/I18nContext";

/** Flatten a nested locale object into a list of dot-path keys. */
function collectKeys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    collectKeys(value, prefix ? `${prefix}.${key}` : key)
  );
}

describe("i18n core", () => {
  it("translates dot-path keys per locale", () => {
    expect(translate("en", "dashboard.title")).toBe("Dashboard");
    expect(translate("es", "dashboard.title")).toBe("Panel");
    expect(translate("en", "sendPayment.memoPlaceholder")).toBe("Payment note...");
    expect(translate("es", "sendPayment.memoPlaceholder")).toBe("Nota del pago...");
  });

  it("returns the key itself when no locale defines it", () => {
    expect(translate("es", "does.not.exist")).toBe("does.not.exist");
  });

  it("interpolates named values and leaves unknown tokens intact", () => {
    expect(translate("en", "dashboard.selectedPeriod", { label: "Mar 2026" })).toBe(
      "Selected Period: Mar 2026"
    );
    expect(translate("es", "dashboard.selectedPeriod", { label: "mar 2026" })).toBe(
      "Período seleccionado: mar 2026"
    );
    expect(translate("en", "sendPayment.amount", { asset: "USDC" })).toBe(
      "Amount (USDC)"
    );
    expect(interpolate("{known} {unknown}", { known: "a" })).toBe("a {unknown}");
    expect(interpolate("no tokens", { unused: "x" })).toBe("no tokens");
  });

  it("binds a translator to a locale", () => {
    const t = createTranslator("es");
    expect(t("common.retry")).toBe("Reintentar");
    expect(t("dashboard.totalSent")).toBe("Total enviado");
  });

  it("looks up nested messages and reports misses as undefined", () => {
    expect(lookupMessage(en as never, "settings.language.title")).toBe("Language");
    expect(lookupMessage(en as never, "settings.language")).toBeUndefined();
    expect(lookupMessage(en as never, "settings.nope.deeper")).toBeUndefined();
  });

  it("recognises supported locales only", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(SUPPORTED_LOCALES).toEqual(["en", "es"]);
    expect(DEFAULT_LOCALE).toBe("en");
    expect(LOCALE_LABELS.es).toBe("Español");
  });

  it("persists and restores the locale from localStorage", () => {
    window.localStorage.clear();

    expect(getStoredLocale()).toBe("en");

    setStoredLocale("es");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");
    expect(getStoredLocale()).toBe("es");

    window.localStorage.setItem(LOCALE_STORAGE_KEY, "klingon");
    expect(getStoredLocale()).toBe("en");
  });

  it("keeps <html lang> in sync with the locale", () => {
    applyDocumentLocale("es");
    expect(document.documentElement.lang).toBe("es");

    applyDocumentLocale("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("locale files", () => {
  it("define exactly the same keys", () => {
    expect(collectKeys(es).sort()).toEqual(collectKeys(en).sort());
  });

  it("have no empty strings", () => {
    const empty = [en, es].flatMap((tree) =>
      collectKeys(tree).filter((key) => lookupMessage(tree as never, key) === "")
    );

    expect(empty).toEqual([]);
  });
});

/** Small consumer that exposes the hook's API to assertions. */
function LocaleProbe() {
  const { t, locale, setLocale, availableLocales } = useTranslation();

  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="heading">{t("dashboard.title")}</span>
      <span data-testid="count">
        {t("dashboard.outgoingPaymentsPlural", { count: 3 })}
      </span>
      <span data-testid="available">{availableLocales.join(",")}</span>
      <button onClick={() => setLocale("es")}>switch-es</button>
      <button onClick={() => setLocale("en")}>switch-en</button>
    </div>
  );
}

describe("I18nProvider / useTranslation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to English without a provider", () => {
    render(<LocaleProbe />);

    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(screen.getByTestId("heading")).toHaveTextContent("Dashboard");
    expect(screen.getByTestId("available")).toHaveTextContent("en,es");
  });

  it("switches locale immediately without a page reload", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>
    );

    expect(screen.getByTestId("heading")).toHaveTextContent("Dashboard");

    await user.click(screen.getByRole("button", { name: "switch-es" }));

    expect(screen.getByTestId("locale")).toHaveTextContent("es");
    expect(screen.getByTestId("heading")).toHaveTextContent("Panel");
    expect(screen.getByTestId("count")).toHaveTextContent("3 pagos enviados");
    expect(document.documentElement.lang).toBe("es");

    await user.click(screen.getByRole("button", { name: "switch-en" }));
    expect(screen.getByTestId("heading")).toHaveTextContent("Dashboard");
    expect(document.documentElement.lang).toBe("en");
  });

  it("persists the chosen locale and restores it on mount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: "switch-es" }));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");

    unmount();

    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("locale")).toHaveTextContent("es")
    );
    expect(screen.getByTestId("heading")).toHaveTextContent("Panel");
  });
});

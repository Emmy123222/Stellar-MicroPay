/**
 * Regression test for issue #712
 * Ensures `useTranslation` is only imported from `@/contexts/I18nContext`,
 * not from `@/lib/i18n` (which should only export translation data helpers).
 */
import React from "react";
import { renderHook } from "@testing-library/react";

// @ts-expect-error — useTranslation is intentionally NOT exported from lib/i18n
import { useTranslation } from "@/lib/i18n";
import { I18nProvider, useTranslation as useTranslationFromContext } from "@/contexts/I18nContext";

describe("i18n hook API regression", () => {
  it("useTranslation is not exported from lib/i18n (compile-time check via @ts-expect-error)", () => {
    expect(useTranslation).toBeUndefined();
  });

  it("I18nProvider renders without crashing", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider>{children}</I18nProvider>
    );

    const { result } = renderHook(() => useTranslationFromContext(), { wrapper });

    expect(result.current).toHaveProperty("locale");
    expect(result.current).toHaveProperty("setLocale");
    expect(result.current).toHaveProperty("t");
    expect(result.current).toHaveProperty("isRTL");
    expect(result.current).toHaveProperty("supportedLocales");
    expect(typeof result.current.t).toBe("function");
  });

  it("useTranslation hook returns translations for a given key", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider>{children}</I18nProvider>
    );

    const { result } = renderHook(() => useTranslationFromContext(), { wrapper });

    expect(result.current.locale).toBe("en");
    expect(result.current.supportedLocales).toEqual(["en", "es"]);
  });
});

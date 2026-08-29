/**
 * __tests__/i18n.test.ts
 * Unit tests for i18n helpers: native display names, RTL detection, persistence.
 */

import {
  DEFAULT_LOCALE,
  RTL_LOCALES,
  SUPPORTED_LOCALES,
  getLocaleDisplayName,
  getTranslations,
  getStoredLocale,
  isRTL,
  setStoredLocale,
} from "../lib/i18n";

const ORIGINAL_WINDOW = globalThis.window;

describe("i18n helpers", () => {
  afterEach(() => {
    localStorage.clear();
    globalThis.window = ORIGINAL_WINDOW;
  });

  describe("getLocaleDisplayName", () => {
    it("returns native language names, not translated equivalents", () => {
      expect(getLocaleDisplayName("en")).toBe("English");
      expect(getLocaleDisplayName("es")).toBe("Español");
    });
  });

  describe("RTL support", () => {
    it("treats all supported locales as LTR", () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(isRTL(locale)).toBe(false);
      }
    });

    it("lists known RTL scripts in the canonical RTL_LOCALES list", () => {
      expect(RTL_LOCALES).toContain("ar");
      expect(RTL_LOCALES).toContain("he");
    });

    it("returns false for unknown locales", () => {
      expect(isRTL("fr" as never)).toBe(false);
    });
  });

  describe("locale persistence", () => {
    it("round-trips a persisted locale through localStorage", () => {
      setStoredLocale("es");
      expect(getStoredLocale()).toBe("es");
    });

    it("falls back to the default when nothing is stored or the value is invalid", () => {
      expect(getStoredLocale()).toBe(DEFAULT_LOCALE);
      localStorage.setItem("stellar-micropay:locale", "fr");
      expect(getStoredLocale()).toBe(DEFAULT_LOCALE);
    });

    it("falls back when window is undefined (SSR path)", () => {
      globalThis.window = undefined as unknown as Window & typeof globalThis;
      expect(getStoredLocale()).toBe(DEFAULT_LOCALE);
      expect(() => setStoredLocale("es")).not.toThrow();
    });
  });

  describe("getTranslations", () => {
    it("returns locale-appropriate selectLanguage copy", () => {
      expect(getTranslations("en").common.selectLanguage).toBe("Select language");
      expect(getTranslations("es").common.selectLanguage).toBe("Seleccionar idioma");
    });
  });
});
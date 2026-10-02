/**
 * contexts/I18nContext.tsx
 * React context provider for internationalization.
 *
 * Mount `I18nProvider` once (see `pages/_app.tsx`) and call `useTranslation()`
 * anywhere below it:
 *
 *   const { t, locale, setLocale } = useTranslation();
 *   <h1>{t("dashboard.title")}</h1>
 *
 * The context has an English default value, so components rendered without a
 * provider (for example in unit tests) keep working instead of throwing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  applyDocumentLocale,
  createTranslator,
  getStoredLocale,
  isLocale,
  setStoredLocale,
  type Locale,
  type Translate,
} from "@/lib/i18n";

export interface I18nContextValue {
  /** Active locale. */
  locale: Locale;
  /** Switch locale: updates state, `<html lang>` and localStorage immediately. */
  setLocale: (locale: Locale) => void;
  /** Translator bound to {@link I18nContextValue.locale}. */
  t: Translate;
  /** Locales the language picker can offer. */
  availableLocales: readonly Locale[];
}

/** English-only default so `useTranslation()` works outside a provider. */
export const defaultI18nValue: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: createTranslator(DEFAULT_LOCALE),
  availableLocales: SUPPORTED_LOCALES,
};

const I18nContext = createContext<I18nContextValue>(defaultI18nValue);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Hydration can't read localStorage, so the stored locale is applied on mount.
  useEffect(() => {
    const stored = getStoredLocale();
    setLocaleState(stored);
    applyDocumentLocale(stored);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;

    setLocaleState(next);
    setStoredLocale(next);
    applyDocumentLocale(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: createTranslator(locale),
      availableLocales: SUPPORTED_LOCALES,
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Full i18n context, including locale control. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/**
 * Primary hook for components.
 *
 * @returns A `t(key, values?)` translator plus the active locale and setter.
 */
export function useTranslation() {
  const { t, locale, setLocale, availableLocales } = useContext(I18nContext);
  return { t, locale, setLocale, availableLocales };
}

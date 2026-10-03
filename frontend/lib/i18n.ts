/**
 * lib/i18n.ts
 * Lightweight internationalization for Stellar MicroPay.
 *
 * Messages live in `locales/<locale>.json` as nested objects and are addressed
 * with dot-path keys, e.g. `t("dashboard.totalSent")`. Values may interpolate
 * with `{placeholders}`, and any key missing from the active locale falls back
 * to English before finally falling back to the key itself — so a half
 * translated locale never renders `undefined`.
 *
 * No external dependency is used; the whole system is ~100 lines.
 */

import en from "@/locales/en.json";
import es from "@/locales/es.json";

/** Locales the app ships with. */
export type Locale = "en" | "es";

/** English is the default and the fallback for every missing key. */
export const DEFAULT_LOCALE: Locale = "en";

/** Every supported locale, in picker order. */
export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "es"];

/** localStorage key holding the user's chosen locale. */
export const LOCALE_STORAGE_KEY = "stellar-micropay:locale";

/** Human-readable locale names, shown in the language picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

/** Values substituted into `{placeholder}` tokens. */
export type TranslationValues = Record<string, string | number>;

/** A translator bound to a locale. */
export type Translate = (key: string, values?: TranslationValues) => string;

type MessageTree = Record<string, unknown>;

const MESSAGES: Record<Locale, MessageTree> = {
  en: en as MessageTree,
  es: es as MessageTree,
};

/** Narrow an unknown value (e.g. a localStorage entry) to a supported locale. */
export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Resolve a dot-path key inside a message tree.
 *
 * @returns The message string, or `undefined` when the path is missing or does
 *          not point at a string.
 */
export function lookupMessage(
  tree: MessageTree,
  key: string
): string | undefined {
  let node: unknown = tree;

  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }

  return typeof node === "string" ? node : undefined;
}

/** Replace `{token}` placeholders; unknown tokens are left untouched. */
export function interpolate(
  template: string,
  values?: TranslationValues
): string {
  if (!values) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match
  );
}

/**
 * Translate `key` for `locale`.
 *
 * Fallback order: active locale → English → the raw key.
 */
export function translate(
  locale: Locale,
  key: string,
  values?: TranslationValues
): string {
  const template =
    lookupMessage(MESSAGES[locale], key) ??
    lookupMessage(MESSAGES[DEFAULT_LOCALE], key) ??
    key;

  return interpolate(template, values);
}

/** Bind {@link translate} to a locale, producing a `t(key)` function. */
export function createTranslator(locale: Locale): Translate {
  return (key, values) => translate(locale, key, values);
}

/** Read the persisted locale, defaulting to English. */
export function getStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    // localStorage can throw in private browsing modes — fall back to English.
    return DEFAULT_LOCALE;
  }
}

/** Persist the chosen locale so it survives a reload. */
export function setStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage being unavailable must never break the UI.
  }
}

/** Keep `<html lang>` in sync so screen readers use the right pronunciation. */
export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

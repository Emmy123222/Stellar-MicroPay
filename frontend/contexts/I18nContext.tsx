/**
 * contexts/I18nContext.tsx
 * React context provider for internationalization.
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

import {
  Locale,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getStoredLocale,
  setStoredLocale,
  getTranslations,
  isRTL,
  type Translations,
} from '@/lib/i18n';

const TRANSLATION_DICTIONARY: Record<string, string> = {
  destination: "Destination",
  destination_placeholder: "G... address or alice.xlm",
  amount: "Amount",
  amount_placeholder: "0.0000000",
  memo: "Memo",
  memo_optional: "Memo (optional)",
  memo_placeholder: "Memo text (max 28 bytes)",
  send_payment: "Send Payment",
  sending: "Sending...",
  send: "Send",
  send_button: "Send",
  confirm_title: "Confirm Payment",
  confirm_sign: "Confirm & Sign",
  cancel: "Cancel",
  to: "To",
  estimated_fee: "Estimated Fee",
  max: "Max",
  success_title: "Payment Sent Successfully",
  success_message: "Your transaction has been submitted to the Stellar network.",
  transaction_hash: "Transaction Hash",
  view_explorer: "View on Explorer",
  mint_receipt: "Mint NFT Receipt",
  minting_receipt: "Minting NFT Receipt...",
  send_another: "Send Another Payment",
  contacts: "Contacts",
  close: "Close",
  save_contact: "Save contact",
  remove_contact: "Remove contact",
  scan_qr: "Scan QR",
  memo_required: "Memo is required for this exchange address",
};

export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>
) => string;

function createT(locale: Locale): Translations & TranslateFn {
  const base = getTranslations(locale);
  const fn: TranslateFn = (key, vars) => {
    const template = TRANSLATION_DICTIONARY[key] || key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      name in vars ? String(vars[name]) : match
    );
  };
  return Object.assign(fn, base) as Translations & TranslateFn;
}

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations & TranslateFn;
  isRTL: boolean;
  supportedLocales: Locale[];
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [isClient, setIsClient] = useState(false);

  // Initialize locale from localStorage on mount
  useEffect(() => {
    setIsClient(true);
    const storedLocale = getStoredLocale();
    setLocaleState(storedLocale);
  }, []);

  const setLocale = (newLocale: Locale) => {
    if (!SUPPORTED_LOCALES.includes(newLocale)) {
      console.warn(`Unsupported locale: ${newLocale}`);
      return;
    }
    
    setLocaleState(newLocale);
    setStoredLocale(newLocale);
    
    // Update document direction for RTP support
    if (typeof document !== 'undefined') {
      document.documentElement.dir = isRTL(newLocale) ? 'rtl' : 'ltr';
      document.documentElement.lang = newLocale;
    }
  };

  // Set initial document direction
  useEffect(() => {
    if (isClient && typeof document !== 'undefined') {
      document.documentElement.dir = isRTL(locale) ? 'rtl' : 'ltr';
      document.documentElement.lang = locale;
    }
  }, [locale, isClient]);

  const value: I18nContextType = {
    locale,
    setLocale,
    t: createT(locale),
    isRTL: isRTL(locale),
    supportedLocales: SUPPORTED_LOCALES,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext);
  if (context === undefined) {
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: createT(DEFAULT_LOCALE),
      isRTL: false,
      supportedLocales: SUPPORTED_LOCALES,
    };
  }
  return context;
}

export const useTranslation = (_namespace?: string): I18nContextType => useI18n();
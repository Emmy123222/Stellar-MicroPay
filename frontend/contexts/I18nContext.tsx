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

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
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
    t: getTranslations(locale),
    isRTL: isRTL(locale),
    supportedLocales: SUPPORTED_LOCALES,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

export const useTranslation = useI18n;
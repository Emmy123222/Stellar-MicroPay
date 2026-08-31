/**
 * lib/i18n.ts
 * Lightweight internationalization system for Stellar MicroPay.
 * Supports English and Spanish with locale persistence and RTL readiness.
 */

export type Locale = 'en' | 'es';

export const DEFAULT_LOCALE: Locale = 'en';
export const SUPPORTED_LOCALES: Locale[] = ['en', 'es'];

const LOCALE_STORAGE_KEY = 'stellar-micropay:locale';

// Translation type definitions
export interface Translations {
  nav: {
    home: string;
    dashboard: string;
    trade: string;
    transactions: string;
    network: string;
    settings: string;
    connectWallet: string;
    disconnect: string;
    disconnectConfirm: string;
    confirm: string;
    cancel: string;
  };
  common: {
    loading: string;
    error: string;
    success: string;
    copy: string;
    copied: string;
  };
  dashboard: {
    title: string;
    balance: string;
    available: string;
    reserved: string;
    send: string;
    receive: string;
    recentActivity: string;
    paymentStats: string;
    totalSent: string;
    totalReceived: string;
    transactionCount: string;
  };
}

// English translations
const en: Translations = {
  nav: {
    home: 'Home',
    dashboard: 'Dashboard',
    trade: 'Trade',
    transactions: 'Transactions',
    network: 'Network',
    settings: 'Settings',
    connectWallet: 'Connect Wallet',
    disconnect: 'Disconnect',
    disconnectConfirm: 'Disconnect wallet?',
    confirm: 'Confirm',
    cancel: 'Cancel',
  },
  common: {
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    copy: 'Copy',
    copied: 'Copied!',
  },
  dashboard: {
    title: 'Dashboard',
    balance: 'Balance',
    available: 'Available',
    reserved: 'Reserved',
    send: 'Send',
    receive: 'Receive',
    recentActivity: 'Recent Activity',
    paymentStats: 'Payment Statistics',
    totalSent: 'Total Sent',
    totalReceived: 'Total Received',
    transactionCount: 'Total Transactions',
  },
};

// Spanish translations
const es: Translations = {
  nav: {
    home: 'Inicio',
    dashboard: 'Panel',
    trade: 'Comerciar',
    transactions: 'Transacciones',
    network: 'Red',
    settings: 'Configuración',
    connectWallet: 'Conectar Billetera',
    disconnect: 'Desconectar',
    disconnectConfirm: '¿Desconectar billetera?',
    confirm: 'Confirmar',
    cancel: 'Cancelar',
  },
  common: {
    loading: 'Cargando...',
    error: 'Error',
    success: 'Éxito',
    copy: 'Copiar',
    copied: '¡Copiado!',
  },
  dashboard: {
    title: 'Panel',
    balance: 'Saldo',
    available: 'Disponible',
    reserved: 'Reservado',
    send: 'Enviar',
    receive: 'Recibir',
    recentActivity: 'Actividad Reciente',
    paymentStats: 'Estadísticas de Pagos',
    totalSent: 'Total Enviado',
    totalReceived: 'Total Recibido',
    transactionCount: 'Total de Transacciones',
  },
};

const translations: Record<Locale, Translations> = { en, es };

/**
 * Get translations for a specific locale
 */
export function getTranslations(locale: Locale): Translations {
  return translations[locale] || translations[DEFAULT_LOCALE];
}

/**
 * Get the current locale from localStorage or default
 */
export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) {
      return stored as Locale;
    }
  } catch {
    // localStorage might be disabled
  }
  
  return DEFAULT_LOCALE;
}

/**
 * Save locale to localStorage
 */
export function setStoredLocale(locale: Locale): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // localStorage might be disabled
  }
}

/**
 * Get locale display name
 */
export function getLocaleDisplayName(locale: Locale): string {
  const names: Record<Locale, string> = {
    en: 'English',
    es: 'Español',
  };
  return names[locale] || locale;
}

/**
 * Check if locale is RTL right-to-left)
 * Currently all supported locales are LTR, but this prepares for future RTL support
 */
export function isRTL(locale: Locale): boolean {
  const rtlLocales: Locale[] = [];
  return rtlLocales.includes(locale);
}

// Re-export the canonical translation hook from the I18n context
export { useTranslation } from '../contexts/I18nContext';

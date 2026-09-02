/**
 * lib/i18n.ts
 * Lightweight internationalization system for Stellar MicroPay.
 * Supports English and Spanish with locale persistence and RTL readiness.
 */

import { useEffect, useMemo, useState } from "react";

export type Locale = 'en' | 'es';

export const DEFAULT_LOCALE: Locale = 'en';
export const SUPPORTED_LOCALES: Locale[] = ['en', 'es'];

const LOCALE_STORAGE_KEY = 'stellar-micropay:locale';
const LOCALE_CHANGE_EVENT = 'stellar-micropay:locale-change';

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
  if (typeof window === "undefined") return;
  
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // localStorage might be disabled
  }

// Broadcast so `useTranslation` consumers react immediately.
  window.dispatchEvent(new CustomEvent<Locale>(LOCALE_CHANGE_EVENT, { detail: locale }));
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

// ─── Function-based `t` API ───────────────────────────────────────────────────
//
// The pages/components historically call a flat `t("snake_case_key", params?)`
// translator (i18next-style). We keep the object-based `Translations` above for
// backwards compatibility and expose that flat API here.

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

/**
 * Hybrid translator: callable as `t("key", params)` AND exposes the typed
 * `Translations` namespaces as properties (`t.nav.home`, `t.common.copy`, …).
 */
export type I18nT = Translations & TFunction;

/**
 * Build a hybrid translator bound to `locale`. Reuse the returned instance for
 * the lifetime of a render (the object-based namespaces never change for a
 * given locale).
 */
export function createTranslator(locale: Locale): I18nT {
  const translations = getTranslations(locale);
  return Object.assign(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    translations
  ) as I18nT;
}

const FLAT_EN: Record<string, string> = {
  address_copied: 'Address copied',
  amount: 'Amount ({asset})',
  amount_placeholder: 'e.g. 0.0000000',
  cancel: 'Cancel',
  checking_account: 'Checking account…',
  close: 'Close',
  collapse: 'Collapse',
  confirm_sign: 'Confirm & Sign',
  confirm_title: 'Confirm Payment',
  connect_wallet_msg: 'Connect your wallet to get started',
  contacts: 'Contacts',
  copied_address: 'Address copied!',
  copy_address: 'Copy address',
  custom: 'Custom',
  dashboard: 'Dashboard',
  destination: 'Destination',
  destination_placeholder: 'G... address or alice.xlm',
  disable_notifications: 'Disable notifications',
  disconnect_confirm: 'Disconnect wallet?',
  enable_notifications: 'Enable notifications',
  estimated_fee: 'Estimated fee',
  high_value_warning:
    'This amount exceeds the Multi-Signature threshold ({threshold} XLM). This payment will require additional approvals.',
  home: 'Home',
  loading_ai: 'Loading AI assistant…',
  mainnet: 'Mainnet',
  max: 'Max: {amount}',
  memo: 'Memo',
  memo_limit: 'Memo is limited to 28 bytes',
  memo_optional: 'Memo (optional)',
  memo_placeholder: 'Enter a memo for this payment',
  memo_required: 'Memo is required for this exchange address',
  mint_receipt: 'Mint receipt',
  mint_success: 'Receipt minted successfully',
  minting_receipt: 'Minting receipt…',
  network: 'Network',
  network_aria: 'Network status: {level}',
  network_title: 'Network: {level}',
  notifications_blocked: 'Notifications are blocked by the browser',
  notifications_disabled: 'Notifications disabled',
  notifications_enabled: 'Notifications enabled',
  offline_snapshot: 'Showing snapshot from {time}',
  processing: 'Processing…',
  quick_send: 'Quick send',
  remove_contact: 'Remove contact',
  save_contact: 'Save contact',
  scan_qr: 'Scan QR code',
  send: 'Send',
  send_another: 'Send another payment',
  send_button: 'Send {amount} {asset}',
  send_payment: 'Send Payment',
  sending: 'Sending…',
  settings: 'Settings',
  show_full: 'Show full address',
  stellar_micropay: 'Stellar MicroPay',
  subtitle: 'Welcome back',
  success_message: 'Your payment has been sent successfully',
  success_title: 'Payment Sent',
  switch_dark: 'Switch to dark theme',
  switch_light: 'Switch to light theme',
  test_notification: 'Test notification',
  testnet: 'Testnet',
  title: 'Dashboard',
  to: 'To',
  trade: 'Trade',
  transaction_hash: 'Transaction hash',
  transactions: 'Transactions',
  view_explorer: 'View on explorer',
  wallet_address: 'Wallet address',
};

const FLAT_ES: Record<string, string> = {
  address_copied: 'Dirección copiada',
  amount: 'Cantidad ({asset})',
  amount_placeholder: 'p. ej. 0.0000000',
  cancel: 'Cancelar',
  checking_account: 'Comprobando cuenta…',
  close: 'Cerrar',
  collapse: 'Contraer',
  confirm_sign: 'Confirmar y firmar',
  confirm_title: 'Confirmar pago',
  connect_wallet_msg: 'Conecta tu billetera para comenzar',
  contacts: 'Contactos',
  copied_address: '¡Dirección copiada!',
  copy_address: 'Copiar dirección',
  custom: 'Personalizado',
  dashboard: 'Panel',
  destination: 'Destino',
  destination_placeholder: 'Dirección G... o alice.xlm',
  disable_notifications: 'Desactivar notificaciones',
  disconnect_confirm: '¿Desconectar billetera?',
  enable_notifications: 'Activar notificaciones',
  estimated_fee: 'Tarifa estimada',
  high_value_warning:
    'Este monto supera el umbral de Multi-firma ({threshold} XLM). Este pago requerirá aprobaciones adicionales.',
  home: 'Inicio',
  loading_ai: 'Cargando asistente de IA…',
  mainnet: 'Red principal',
  max: 'Máx: {amount}',
  memo: 'Memo',
  memo_limit: 'El memo está limitado a 28 bytes',
  memo_optional: 'Memo (opcional)',
  memo_placeholder: 'Introduce un memo para este pago',
  memo_required: 'Se requiere memo para esta dirección de intercambio',
  mint_receipt: 'Acuñar recibo',
  mint_success: 'Recibo acuñado con éxito',
  minting_receipt: 'Acuñando recibo…',
  network: 'Red',
  network_aria: 'Estado de la red: {level}',
  network_title: 'Red: {level}',
  notifications_blocked: 'El navegador ha bloqueado las notificaciones',
  notifications_disabled: 'Notificaciones desactivadas',
  notifications_enabled: 'Notificaciones activadas',
  offline_snapshot: 'Mostrando instantánea de {time}',
  processing: 'Procesando…',
  quick_send: 'Envío rápido',
  remove_contact: 'Eliminar contacto',
  save_contact: 'Guardar contacto',
  scan_qr: 'Escanear código QR',
  send: 'Enviar',
  send_another: 'Enviar otro pago',
  send_button: 'Enviar {amount} {asset}',
  send_payment: 'Enviar pago',
  sending: 'Enviando…',
  settings: 'Configuración',
  show_full: 'Mostrar dirección completa',
  stellar_micropay: 'Stellar MicroPay',
  subtitle: 'Bienvenido de nuevo',
  success_message: 'Tu pago se ha enviado con éxito',
  success_title: 'Pago enviado',
  switch_dark: 'Cambiar a tema oscuro',
  switch_light: 'Cambiar a tema claro',
  test_notification: 'Notificación de prueba',
  testnet: 'Red de prueba',
  title: 'Panel',
  to: 'Para',
  trade: 'Comerciar',
  transaction_hash: 'Hash de la transacción',
  transactions: 'Transacciones',
  view_explorer: 'Ver en el explorador',
  wallet_address: 'Dirección de la billetera',
};

/**
 * Resolve a flat translation key for the given locale.
 * Unknown keys fall back to the key itself so the UI never throws.
 */
function resolveFlatKey(locale: Locale, key: string): string {
  if (locale === 'es') return FLAT_ES[key] ?? FLAT_EN[key] ?? key;
  return FLAT_EN[key] ?? key;
}

/**
 * Translate a flat `key` for `locale`, interpolating `{name}` placeholders
 * with the values in `params`.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  let text = resolveFlatKey(locale, key);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/**
 * React hook mirroring the classic `useTranslation(namespace)` API.
 * Returns a memoised hybrid `t` bound to the current locale—callable as
 * `t("key", params?)` and exposing the `Translations` namespaces as properties.
 * Locale changes issued through {@link setStoredLocale} (e.g. from the
 * I18nProvider) re-render consumers automatically.
 */
export function useTranslation(_namespace?: string): { t: I18nT } {
  const [locale, setLocale] = useState<Locale>(() =>
    typeof window === 'undefined' ? DEFAULT_LOCALE : getStoredLocale()
  );

  useEffect(() => {
    const handleLocaleEvent = (event: Event) => {
      const detail = (event as CustomEvent<Locale>).detail;
      if (SUPPORTED_LOCALES.includes(detail)) {
        setLocale(detail);
      }
    };

    const handleStorageEvent = (event: StorageEvent) => {
      if (
        event.key === LOCALE_STORAGE_KEY &&
        event.newValue &&
        SUPPORTED_LOCALES.includes(event.newValue as Locale)
      ) {
        setLocale(event.newValue as Locale);
      }
    };

    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleEvent);
    window.addEventListener('storage', handleStorageEvent);
    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleEvent);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  const t = useMemo<I18nT>(() => createTranslator(locale), [locale]);

  return { t };
}

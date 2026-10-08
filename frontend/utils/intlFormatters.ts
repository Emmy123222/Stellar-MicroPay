/**
 * utils/intlFormatters.ts
 * 
 * Shared Intl-based formatters that preserve exact machine values while localizing display.
 * All formatters respect user locale, timezone, and accessibility requirements.
 * 
 * These replace hard-coded toFixed(), English-only date strings, and provider-dependent formatting.
 */

// ─── Locale Management ──────────────────────────────────────────────────────

/**
 * Get the current user locale from browser or fallback to 'en-US'.
 * Supports both browser and server-side rendering contexts.
 */
export function getUserLocale(): string {
  if (typeof navigator !== 'undefined') {
    return navigator.language || navigator.languages?.[0] || 'en-US';
  }
  return 'en-US';
}

/**
 * Get the user's timezone from browser API or fallback to 'UTC'.
 */
let cachedTimezone: string | null = null;
export function getUserTimezone(): string {
  if (cachedTimezone !== null) return cachedTimezone;
  try {
    cachedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    cachedTimezone = 'UTC';
  }
  return cachedTimezone;
}

// ─── Formatter Cache ────────────────────────────────────────────────────────
//
// Constructing an Intl formatter is comparatively expensive; the same handful
// of option combinations are reused across renders, so memoize them.

const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

function getCachedNumberFormat(
  locale: string,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

function getCachedDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateTimeFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatCache.set(key, formatter);
  }
  return formatter;
}

// ─── Number Formatters ──────────────────────────────────────────────────────

export interface AssetFormatOptions {
  locale?: string;
  preserveTrailingZeros?: boolean;
  useGrouping?: boolean;
}

export interface AssetFormatRule {
  minimumFractionDigits: number;
  maximumFractionDigits: number;
}

const DEFAULT_ASSET_CODE = 'XLM';
const ASSET_FORMAT_RULES: Record<string, AssetFormatRule> = {
  XLM: {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  },
  USDC: {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6, // Support very small USDC amounts
  },
  AQUA: {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  },
  // Default for unknown assets
  DEFAULT: {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  },
};

function normalizeAssetCode(assetCode?: string): string {
  return assetCode?.trim().toUpperCase() || DEFAULT_ASSET_CODE;
}

function getAssetFormatRule(assetCode?: string): AssetFormatRule {
  const normalized = normalizeAssetCode(assetCode);
  return ASSET_FORMAT_RULES[normalized] ?? ASSET_FORMAT_RULES.DEFAULT;
}

/**
 * Format a number value using Intl.NumberFormat with asset-specific precision.
 * 
 * Preserves the exact machine value while localizing the decimal separator,
 * grouping separator, and digit characters.
 * 
 * @param value - The numeric value to format
 * @param assetCode - The asset code (e.g., 'XLM', 'USDC')
 * @param options - Formatting options
 * @returns Localized number string
 * 
 * @example
 * formatNumber(1234.5678, 'XLM', { locale: 'de-DE' })
 * // => "1.234,5678" (German format)
 * 
 * formatNumber(1234.5678, 'XLM', { locale: 'en-US' })
 * // => "1,234.5678" (US format)
 */
export function formatNumber(
  value: string | number,
  assetCode = DEFAULT_ASSET_CODE,
  options: AssetFormatOptions = {}
): string {
  const locale = options.locale ?? getUserLocale();
  const rule = getAssetFormatRule(assetCode);
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (value == null || !Number.isFinite(num)) {
    return formatNumber(0, assetCode, options);
  }

  const formatter = getCachedNumberFormat(locale, {
    minimumFractionDigits: options.preserveTrailingZeros ? rule.maximumFractionDigits : rule.minimumFractionDigits,
    maximumFractionDigits: rule.maximumFractionDigits,
    useGrouping: options.useGrouping ?? true,
  });

  return formatter.format(num);
}

/**
 * Format an asset amount with the asset code appended.
 * 
 * @param amount - The amount to format
 * @param assetCode - The asset code (e.g., 'XLM', 'USDC')
 * @param options - Formatting options
 * @returns Localized amount with asset code
 * 
 * @example
 * formatAsset(1234.5678, 'XLM')
 * // => "1,234.5678 XLM" (en-US)
 * // => "1.234,5678 XLM" (de-DE)
 */
export function formatAsset(
  amount: string | number,
  assetCode = DEFAULT_ASSET_CODE,
  options: AssetFormatOptions = {}
): string {
  const normalized = normalizeAssetCode(assetCode);
  const formatted = formatNumber(amount, normalized, options);
  return `${formatted} ${normalized}`;
}

/**
 * Format XLM amount (convenience wrapper for formatAsset).
 */
export function formatXLM(amount: string | number, options: AssetFormatOptions = {}): string {
  return formatAsset(amount, 'XLM', options);
}

/**
 * Format an asset amount with full precision, preserving trailing zeros.
 * Use for exact ledger values, receipts, and confirmations.
 * 
 * @example
 * formatAssetPrecise(10, 'XLM')
 * // => "10.0000000 XLM"
 * 
 * formatAssetPrecise(15, 'USDC')
 * // => "15.000000 USDC"
 */
export function formatAssetPrecise(
  amount: string | number,
  assetCode = DEFAULT_ASSET_CODE,
  options: Omit<AssetFormatOptions, 'preserveTrailingZeros'> = {}
): string {
  return formatAsset(amount, assetCode, {
    ...options,
    preserveTrailingZeros: true,
  });
}

/**
 * Format XLM amount with full precision (convenience wrapper).
 */
export function formatXLMPrecise(amount: string | number, options: Omit<AssetFormatOptions, 'preserveTrailingZeros'> = {}): string {
  return formatAssetPrecise(amount, 'XLM', options);
}

/**
 * Format very small amounts (< 0.0001) with scientific notation or compact display.
 * 
 * @example
 * formatSmallAmount(0.00000123, 'USDC')
 * // => "~1.23 × 10⁻⁶ USDC"
 */
export function formatSmallAmount(
  amount: string | number,
  assetCode = DEFAULT_ASSET_CODE,
  options: AssetFormatOptions = {}
): string {
  const normalized = normalizeAssetCode(assetCode);
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (amount == null || !Number.isFinite(num) || num === 0) {
    return formatAsset(0, normalized, options);
  }

  // For very small amounts, use scientific notation with a localized
  // multiplication sign and superscript exponent.
  if (Math.abs(num) < 0.0001) {
    const exponent = Math.floor(Math.log10(Math.abs(num)));
    const mantissa = num / Math.pow(10, exponent);
    const superscriptDigits: Record<string, string> = {
      "0": "\u2070",
      "1": "\u00b9",
      "2": "\u00b2",
      "3": "\u00b3",
      "4": "\u2074",
      "5": "\u2075",
      "6": "\u2076",
      "7": "\u2077",
      "8": "\u2078",
      "9": "\u2079",
      "-": "\u207b",
    };
    const exponentText = String(exponent)
      .split("")
      .map((char) => superscriptDigits[char] ?? char)
      .join("");
    return `~${mantissa.toFixed(2)} \u00d7 10${exponentText} ${normalized}`;
  }

  return formatAsset(amount, normalized, options);
}

/**
 * Convert stroops (Stellar's smallest unit) to XLM and format.
 * 1 XLM = 10,000,000 stroops
 * 
 * @param stroops - Amount in stroops (bigint, string, or number)
 * @param options - Formatting options
 * @returns Formatted XLM string
 * 
 * @example
 * formatStroopsToXLM(10000000n)
 * // => "1.0000000 XLM"
 * 
 * formatStroopsToXLM(123456)
 * // => "0.0123456 XLM"
 */
export function formatStroopsToXLM(
  stroops: bigint | string | number,
  options: Omit<AssetFormatOptions, 'preserveTrailingZeros'> = {}
): string {
  try {
    if (stroops === null || stroops === undefined) {
      return formatXLMPrecise(0, options);
    }

    const stroopsValue = typeof stroops === 'bigint' ? stroops : BigInt(stroops);
    const xlm = Number(stroopsValue) / 10_000_000;
    
    return formatXLMPrecise(xlm, options);
  } catch (err) {
    console.error('Invalid stroops value:', stroops, err);
    return formatXLMPrecise(0, options);
  }
}

/**
 * Format USD currency amount using Intl.NumberFormat currency formatter.
 * 
 * @param amount - USD amount to format
 * @param options - Formatting options
 * @returns Localized USD string
 * 
 * @example
 * formatUSD(1234.56)
 * // => "≈ $1,234.56 USD" (en-US)
 * // => "≈ 1.234,56 $ USD" (de-DE)
 */
export function formatUSD(
  amount: number,
  options: { locale?: string; showApprox?: boolean } = {}
): string {
  const locale = options.locale ?? getUserLocale();
  const showApprox = options.showApprox ?? true;

  if (!Number.isFinite(amount)) {
    return formatUSD(0, options);
  }

  const formatter = getCachedNumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formatted = formatter.format(amount);
  return showApprox ? `≈ ${formatted}` : formatted;
}

// ─── Date & Time Formatters ────────────────────────────────────────────────

export interface DateFormatOptions {
  locale?: string;
  timezone?: string;
}

/**
 * Format a date using Intl.DateTimeFormat with proper timezone support.
 * 
 * @param date - Date string, Date object, or timestamp
 * @param options - Formatting options
 * @returns Localized date string
 * 
 * @example
 * formatDate('2024-01-15T10:30:00Z')
 * // => "Jan 15, 2024, 10:30 AM" (en-US, local timezone)
 * // => "15 Jan. 2024 10:30" (fr-FR, local timezone)
 */
export function formatDate(
  date: string | Date | number,
  options: DateFormatOptions = {}
): string {
  try {
    const locale = options.locale ?? getUserLocale();
    const timezone = options.timezone ?? getUserTimezone();
    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;

    if (!dateObj || isNaN(dateObj.getTime())) {
      return String(date);
    }

    const formatter = getCachedDateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    });

    return formatter.format(dateObj);
  } catch (err) {
    console.error('Invalid date:', date, err);
    return String(date);
  }
}

/**
 * Format date as full format including seconds and timezone.
 * 
 * @example
 * formatDateFull('2024-01-15T10:30:45Z')
 * // => "January 15, 2024 at 10:30:45 AM PST"
 */
export function formatDateFull(
  date: string | Date | number,
  options: DateFormatOptions = {}
): string {
  try {
    const locale = options.locale ?? getUserLocale();
    const timezone = options.timezone ?? getUserTimezone();
    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;

    if (!dateObj || isNaN(dateObj.getTime())) {
      return String(date);
    }

    const formatter = getCachedDateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
      timeZone: timezone,
    });

    return formatter.format(dateObj);
  } catch (err) {
    console.error('Invalid date:', date, err);
    return String(date);
  }
}

/**
 * Format relative time (e.g., "3 minutes ago", "in 2 hours").
 * Uses Intl.RelativeTimeFormat for proper localization and pluralization.
 * 
 * @param date - Date string, Date object, or timestamp
 * @param options - Formatting options
 * @returns Localized relative time string
 * 
 * @example
 * formatRelativeTime(Date.now() - 180000)
 * // => "3 minutes ago" (en-US)
 * // => "vor 3 Minuten" (de-DE)
 * // => "il y a 3 minutes" (fr-FR)
 */
export function formatRelativeTime(
  date: string | Date | number,
  options: { locale?: string; now?: Date } = {}
): string {
  try {
    const locale = options.locale ?? getUserLocale();
    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
    const now = options.now ?? new Date();

    if (!dateObj || isNaN(dateObj.getTime())) {
      return String(date);
    }

    const diffMs = dateObj.getTime() - now.getTime();
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffMs / 60000);
    const diffHour = Math.round(diffMs / 3600000);
    const diffDay = Math.round(diffMs / 86400000);
    const diffMonth = Math.round(diffMs / 2592000000);
    const diffYear = Math.round(diffMs / 31536000000);

    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'long' });

    // Choose the most appropriate unit
    if (Math.abs(diffYear) >= 1) {
      return rtf.format(diffYear, 'year');
    }
    if (Math.abs(diffMonth) >= 1) {
      return rtf.format(diffMonth, 'month');
    }
    if (Math.abs(diffDay) >= 1) {
      return rtf.format(diffDay, 'day');
    }
    if (Math.abs(diffHour) >= 1) {
      return rtf.format(diffHour, 'hour');
    }
    if (Math.abs(diffMin) >= 1) {
      return rtf.format(diffMin, 'minute');
    }
    return rtf.format(diffSec, 'second');
  } catch (err) {
    console.error('Invalid date for relative time:', date, err);
    return String(date);
  }
}

// ─── Plural Forms ──────────────────────────────────────────────────────────

/**
 * Select the correct plural form for a count using Intl.PluralRules.
 * Handles complex pluralization rules for different languages.
 * 
 * @param count - The count value
 * @param forms - Object with plural forms: zero, one, two, few, many, other
 * @param options - Formatting options
 * @returns The appropriate plural form
 * 
 * @example
 * pluralize(0, { zero: 'no items', other: '# items' })
 * // => "no items" (en-US)
 * 
 * pluralize(1, { one: '# item', other: '# items' })
 * // => "1 item" (en-US)
 * 
 * pluralize(5, { one: '# item', other: '# items' })
 * // => "5 items" (en-US)
 * 
 * pluralize(5, { one: '# élément', other: '# éléments' }, { locale: 'fr-FR' })
 * // => "5 éléments" (fr-FR)
 */
export function pluralize(
  count: number,
  forms: {
    zero?: string;
    one?: string;
    two?: string;
    few?: string;
    many?: string;
    other: string;
  },
  options: { locale?: string } = {}
): string {
  const locale = options.locale ?? getUserLocale();

  if (count === 0 && forms.zero) {
    return forms.zero;
  }

  const pr = new Intl.PluralRules(locale);
  const rule = pr.select(count);

  const template = forms[rule as keyof typeof forms] ?? forms.other;
  return template.replace('#', String(count));
}

// ─── Accessibility Helpers ──────────────────────────────────────────────────

/**
 * Format a number for screen readers, ensuring proper pronunciation.
 * 
 * @example
 * formatForScreenReader(1234.5678, 'XLM')
 * // => "1234 point 5678 XLM"
 */
export function formatForScreenReader(
  amount: string | number,
  assetCode = DEFAULT_ASSET_CODE
): string {
  const normalized = normalizeAssetCode(assetCode);
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (!Number.isFinite(num)) {
    return `zero ${normalized}`;
  }

  // Split into integer and decimal parts
  const [integer, decimal] = String(num).split('.');
  
  let result = integer || '0';
  if (decimal) {
    result += ` point ${decimal}`;
  }
  result += ` ${normalized}`;

  return result;
}

/**
 * Shorten a Stellar address for display while maintaining accessibility.
 * 
 * @param address - Full Stellar address
 * @param chars - Number of characters to show at start/end
 * @returns Shortened address
 * 
 * @example
 * shortenAddress('GABC...XYZ123', 4)
 * // => "GABC...XYZ1"
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) {
    return address;
  }
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// ─── Validation & Error Handling ────────────────────────────────────────────

/**
 * Validate that a date string or object is valid.
 * Returns null if valid, error message if invalid.
 */
export function validateDate(date: unknown): string | null {
  try {
    if (date === null || date === undefined) {
      return 'Date is required';
    }

    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;

    if (!(dateObj instanceof Date)) {
      return 'Invalid date type';
    }

    if (isNaN(dateObj.getTime())) {
      return 'Invalid date value';
    }

    return null;
  } catch {
    return 'Failed to parse date';
  }
}

/**
 * Validate that an amount is a valid number for an asset.
 * Returns null if valid, error message if invalid.
 */
export function validateAmount(
  amount: unknown,
  assetCode = DEFAULT_ASSET_CODE
): string | null {
  try {
    if (amount === null || amount === undefined || amount === '') {
      return 'Amount is required';
    }

    const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);

    if (!Number.isFinite(num)) {
      return 'Amount must be a valid number';
    }

    if (num <= 0) {
      return 'Amount must be greater than zero';
    }

    const rule = getAssetFormatRule(assetCode);
    const decimals = String(num).split('.')[1]?.length ?? 0;
    
    if (decimals > rule.maximumFractionDigits) {
      return `Amount cannot have more than ${rule.maximumFractionDigits} decimal places for ${normalizeAssetCode(assetCode)}`;
    }

    return null;
  } catch {
    return 'Failed to validate amount';
  }
}

// ─── Export for Testing ─────────────────────────────────────────────────────

export const __testing__ = {
  ASSET_FORMAT_RULES,
  normalizeAssetCode,
  getAssetFormatRule,
};

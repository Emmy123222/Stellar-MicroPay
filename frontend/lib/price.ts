/**
 * lib/price.ts
 * Multi-currency XLM fiat-equivalent pricing (Closes #1149).
 *
 * Primary source: Stellar Expert market data API.
 * Fallback: CoinGecko simple price API (keeps dashboard resilient).
 * FX conversion for non-USD fiats via exchangerate.host open API.
 *
 * - Prices cached for 60 seconds (per currency, in-memory).
 * - Currency preference persisted in localStorage.
 * - Graceful `null` when unreachable so UI can show "price unavailable".
 */

export type FiatCurrency = "USD" | "EUR" | "BRL" | "GBP";

export const SUPPORTED_FIAT_CURRENCIES: FiatCurrency[] = ["USD", "EUR", "BRL", "GBP"];

export const FIAT_SYMBOLS: Record<FiatCurrency, string> = {
  USD: "$",
  EUR: "€",
  BRL: "R$",
  GBP: "£",
};

const CURRENCY_STORAGE_KEY = "stellar-micropay:fiat-currency";
const PRICE_CACHE_TTL_MS = 60_000;

interface PriceCacheEntry {
  value: number | null;
  fetchedAt: number;
}

const priceCache = new Map<string, PriceCacheEntry>();

export function getFiatCurrencyPreference(): FiatCurrency {
  if (typeof window === "undefined") return "USD";
  try {
    const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (stored === "USD" || stored === "EUR" || stored === "BRL" || stored === "GBP") {
      return stored;
    }
  } catch {
    // ignore storage errors (private mode, etc.)
  }
  return "USD";
}

export function setFiatCurrencyPreference(currency: FiatCurrency): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
  } catch {
    // ignore storage errors
  }
}

function getCachedPrice(currency: FiatCurrency): number | null | undefined {
  const entry = priceCache.get(currency);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > PRICE_CACHE_TTL_MS) {
    priceCache.delete(currency);
    return undefined;
  }
  return entry.value;
}

function setCachedPrice(currency: FiatCurrency, value: number | null): void {
  priceCache.set(currency, { value, fetchedAt: Date.now() });
}

export function clearPriceCache(): void {
  priceCache.clear();
}

/**
 * Fetch XLM/USD from Stellar Expert market data API.
 *
 * Tries the public ticker endpoint first. Response shapes vary across
 * Stellar Expert releases, so several shapes are accepted:
 *   - { price: "0.12" } / { price_usd: 0.12 } / { usd: 0.12 }
 *   - { _embedded: { records: [{ price ... }] } }
 *   - [[ "XLM", 0.12 ]] style arrays
 */
async function fetchXlmUsdFromStellarExpert(): Promise<number | null> {
  const endpoints = [
    "https://api.stellar.expert/explorer/public/ticker",
    "https://api.stellar.expert/explorer/public/asset/XLM/ticker",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const price = extractUsdPrice(data);
      if (price !== null) return price;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

function extractUsdPrice(data: unknown): number | null {
  if (data === null || data === undefined) return null;

  if (typeof data === "number" && Number.isFinite(data) && data > 0) return data;

  if (Array.isArray(data)) {
    for (const item of data) {
      const nested = extractUsdPrice(item);
      if (nested !== null) return nested;
    }
    return null;
  }

  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const directKeys = ["price", "price_usd", "priceUsd", "usd", "USD", "lastPrice", "last_price"];
    for (const key of directKeys) {
      const v = Number(obj[key]);
      if (Number.isFinite(v) && v > 0) return v;
    }
    // Stellar Expert ticker records: { asset: "XLM...", price: ... }
    const embedded = obj["_embedded"] as { records?: unknown[] } | undefined;
    if (embedded && Array.isArray(embedded.records)) {
      for (const record of embedded.records) {
        const nested = extractUsdPrice(record);
        if (nested !== null) return nested;
      }
    }
    // Generic deep scan (one level) for { XLM: { usd: ... } } shapes
    for (const value of Object.values(obj)) {
      if (value !== null && typeof value === "object") {
        const nested = extractUsdPrice(value);
        if (nested !== null) return nested;
      }
    }
  }

  return null;
}

async function fetchXlmPriceFromCoinGecko(currency: FiatCurrency): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=${currency.toLowerCase()}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const value = Number(data?.stellar?.[currency.toLowerCase()]);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Convert a USD amount into the target fiat using a free FX table. */
async function convertUsdToFiat(usdAmount: number, currency: FiatCurrency): Promise<number | null> {
  if (currency === "USD") return usdAmount;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) return null;
    const data = await res.json();
    const rate = Number(data?.rates?.[currency]);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return usdAmount * rate;
  } catch {
    return null;
  }
}

/**
 * Fetch the current XLM price in the requested fiat currency.
 * Cached for 60 seconds. Returns `null` when unreachable.
 */
export async function getXlmPrice(currency: FiatCurrency = "USD"): Promise<number | null> {
  const cached = getCachedPrice(currency);
  if (cached !== undefined) return cached;

  // 1. Stellar Expert (primary, USD-denominated market data)
  const expertUsd = await fetchXlmUsdFromStellarExpert();

  if (expertUsd !== null) {
    if (currency === "USD") {
      setCachedPrice(currency, expertUsd);
      return expertUsd;
    }
    const converted = await convertUsdToFiat(expertUsd, currency);
    if (converted !== null) {
      setCachedPrice(currency, converted);
      return converted;
    }
    // FX lookup failed — still cache the USD fallback? No: fall through
    // to CoinGecko which quotes the target fiat directly.
  }

  // 2. CoinGecko fallback (direct fiat quote)
  const fallback = await fetchXlmPriceFromCoinGecko(currency);
  setCachedPrice(currency, fallback);
  return fallback;
}

/**
 * Format a fiat equivalent, e.g. `~$150.00 USD` / `~€135,00 EUR`.
 * Uses en-US grouping so existing tests (`≈ $150.00 USD`) keep passing.
 */
export function formatFiatEquivalent(xlmBalance: string | number, price: number, currency: FiatCurrency): string {
  const balance = typeof xlmBalance === "string" ? parseFloat(xlmBalance) : xlmBalance;
  const total = (Number.isFinite(balance) ? balance : 0) * price;
  const symbol = FIAT_SYMBOLS[currency];
  const formatted = total.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `≈ ${symbol}${formatted} ${currency}`;
}

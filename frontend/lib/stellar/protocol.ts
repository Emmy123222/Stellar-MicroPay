/** Stellar protocol limits and pure helpers with no network dependencies. */

export const STELLAR_STROOPS_PER_XLM = 10_000_000;
export const STELLAR_BASE_FEE_STROOPS = 100;
export const STELLAR_BASE_FEE_XLM =
  STELLAR_BASE_FEE_STROOPS / STELLAR_STROOPS_PER_XLM;
export const STELLAR_TRANSACTION_TIMEOUT_SECONDS = 60;
export const STELLAR_MEMO_TEXT_MAX_BYTES = 28;
export const STELLAR_BASE_ACCOUNT_RESERVE_COUNT = 2;
export const STELLAR_BASE_RESERVE_XLM = 0.5;
export const STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM =
  STELLAR_BASE_ACCOUNT_RESERVE_COUNT * STELLAR_BASE_RESERVE_XLM;

export function truncateMemoText(memo: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(memo).length <= STELLAR_MEMO_TEXT_MAX_BYTES) return memo;

  let truncated = "";
  for (const char of memo) {
    const next = truncated + char;
    if (encoder.encode(next).length > STELLAR_MEMO_TEXT_MAX_BYTES) break;
    truncated = next;
  }
  return truncated;
}

export function calculateMinimumBalance(subentryCount: number): number {
  const safeSubentryCount =
    Number.isFinite(subentryCount) && subentryCount >= 0 ? subentryCount : 0;
  return (
    STELLAR_BASE_ACCOUNT_RESERVE_COUNT + safeSubentryCount
  ) * STELLAR_BASE_RESERVE_XLM;
}

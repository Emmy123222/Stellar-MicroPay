/**
 * lib/anchor.ts
 * SEP-0006 anchor integration helpers (Closes #1142).
 *
 * Follows https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0006.md
 * Tested against the public testnet anchor (e.g. https://testanchor.stellar.org).
 */

export const DEFAULT_ANCHOR_URL =
  process.env.NEXT_PUBLIC_ANCHOR_URL || "https://testanchor.stellar.org";

const ANCHOR_URL_STORAGE_KEY = "stellar-micropay:anchor-url";

export function getAnchorUrl(): string {
  if (typeof window === "undefined") return DEFAULT_ANCHOR_URL;
  try {
    return window.localStorage.getItem(ANCHOR_URL_STORAGE_KEY) || DEFAULT_ANCHOR_URL;
  } catch {
    return DEFAULT_ANCHOR_URL;
  }
}

export function setAnchorUrl(url: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANCHOR_URL_STORAGE_KEY, url);
  } catch {
    // ignore
  }
}

export interface AnchorInfo {
  deposit?: Record<string, { enabled: boolean; min_amount?: number; max_amount?: number }>;
  withdraw?: Record<string, { enabled: boolean; min_amount?: number; max_amount?: number }>;
  [key: string]: unknown;
}

/** GET {anchor}/.well-known/stellar.toml is anchor discovery; /info is SEP-0006 info. */
export async function fetchAnchorInfo(anchorUrl: string): Promise<AnchorInfo> {
  const base = anchorUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/info`);
  if (!res.ok) throw new Error(`Anchor info request failed (${res.status})`);
  return (await res.json()) as AnchorInfo;
}

/** SEP-0006 deposit: returns the interactive web flow URL to redirect the user to. */
export function buildDepositUrl(params: {
  anchorUrl: string;
  assetCode: string;
  account: string;
  lang?: string;
}): string {
  const base = params.anchorUrl.replace(/\/$/, "");
  const qs = new URLSearchParams({
    asset_code: params.assetCode,
    account: params.account,
    lang: params.lang ?? "en",
  });
  return `${base}/transactions/deposit/interactive?${qs.toString()}`;
}

/** SEP-0006 withdraw: submit a withdraw request, then await the Stellar payment. */
export async function submitWithdrawRequest(params: {
  anchorUrl: string;
  assetCode: string;
  amount: string;
  account: string;
  jwt: string;
}): Promise<unknown> {
  const base = params.anchorUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/transactions/withdraw/interactive`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.jwt}`,
    },
    body: JSON.stringify({
      asset_code: params.assetCode,
      amount: params.amount,
      account: params.account,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error || `Withdraw request failed (${res.status})`
    );
  }
  return res.json();
}

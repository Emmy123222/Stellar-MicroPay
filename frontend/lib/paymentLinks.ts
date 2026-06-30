/**
 * @file lib/paymentLinks.ts
 * @description Helpers for shareable payment request links and local status
 * tracking for generated links.
 *
 * Shareable links use explicit query parameters so they can be inspected and
 * shared easily, for example: `/pay?to=G...&amount=10&memo=coffee`. Optional
 * expiry is carried as a Unix timestamp in the `expires` parameter. Legacy
 * base64 `?data=` links are still parsed for backwards compatibility.
 */

const STORAGE_KEY = "micropay.paymentLinks.v1";

export type PaymentLinkStatus = "pending" | "redeemed" | "expired";

export interface PaymentLinkPayload {
  destination: string;
  amount: string;
  memo?: string;
  /** Unix ms; absent means no expiry. */
  validUntil?: number | null;
}

export interface PaymentLinkRecord {
  id: string;
  payload: PaymentLinkPayload;
  url: string;
  status: PaymentLinkStatus;
  createdAt: number;
  redeemedAt?: number;
  redeemedTxHash?: string;
}

type QueryValue = string | string[] | undefined;
export type PaymentLinkQuery = Record<string, QueryValue>;

export type ParsedPaymentLinkQuery =
  | { ok: true; payload: PaymentLinkPayload }
  | { ok: false; reason: "missing" | "malformed" | "invalid-expiry" };

function getQueryString(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function decodeBase64Json(value: string): unknown {
  const json =
    typeof atob === "function"
      ? atob(value)
      : Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(json);
}

function normalizeExpiry(value: unknown): number | null {
  if (value == null || value === "") return null;

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;

  if (Number.isFinite(numeric)) {
    // Accept Unix seconds for easier manual link creation, but store ms.
    return numeric > 0 && numeric < 1_000_000_000_000
      ? Math.trunc(numeric * 1000)
      : Math.trunc(numeric);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return Number.NaN;
}

function coercePayload(raw: unknown): ParsedPaymentLinkQuery {
  if (!raw || typeof raw !== "object")
    return { ok: false, reason: "malformed" };
  const source = raw as Record<string, unknown>;
  const destination =
    typeof source.destination === "string"
      ? source.destination.trim()
      : typeof source.to === "string"
        ? source.to.trim()
        : "";
  const amount = source.amount == null ? "" : String(source.amount).trim();
  const memo = typeof source.memo === "string" ? source.memo.trim() : "";
  const expiryValue = source.validUntil ?? source.expires ?? source.expiry;
  const validUntil = normalizeExpiry(expiryValue);

  if (!destination || !amount) return { ok: false, reason: "missing" };
  if (Number.isNaN(validUntil)) return { ok: false, reason: "invalid-expiry" };

  return {
    ok: true,
    payload: {
      destination,
      amount,
      memo: memo || undefined,
      validUntil,
    },
  };
}

/**
 * Build the public payment request URL required by roadmap v1.5:
 * `/pay?to=G...&amount=10&memo=coffee`, with optional `expires=<unix-ms>`.
 */
export function buildPaymentLinkUrl(
  origin: string,
  payload: PaymentLinkPayload,
): string {
  const url = new URL("/pay", origin);
  url.searchParams.set("to", payload.destination.trim());
  url.searchParams.set("amount", String(payload.amount).trim());
  const memo = payload.memo?.trim();
  if (memo) url.searchParams.set("memo", memo);
  if (payload.validUntil != null) {
    url.searchParams.set("expires", String(Math.trunc(payload.validUntil)));
  }
  return url.toString();
}

/** Parse both the new explicit query-param links and legacy `?data=` links. */
export function parsePaymentLinkQuery(
  query: PaymentLinkQuery,
): ParsedPaymentLinkQuery {
  const encodedData = getQueryString(query.data);
  if (encodedData) {
    try {
      return coercePayload(decodeBase64Json(encodedData));
    } catch {
      return { ok: false, reason: "malformed" };
    }
  }

  const to = getQueryString(query.to);
  const amount = getQueryString(query.amount);
  const memo = getQueryString(query.memo);
  const expires =
    getQueryString(query.expires) ??
    getQueryString(query.expiry) ??
    getQueryString(query.validUntil);

  return coercePayload({ to, amount, memo, expires });
}

/**
 * Stable id for a link payload. Hash-only — does not include a timestamp,
 * so re-encoding the same payload yields the same id and prevents accidental
 * duplicates in the local store.
 */
export function paymentLinkId(payload: PaymentLinkPayload): string {
  const canonical = JSON.stringify({
    destination: payload.destination.trim(),
    amount: String(payload.amount).trim(),
    memo: payload.memo?.trim() || "",
    validUntil: payload.validUntil ?? null,
  });
  // Cheap stable hash — fnv-1a 32-bit. Not crypto, just a deterministic key.
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `pl_${hash.toString(16).padStart(8, "0")}`;
}

function readAll(): Record<string, PaymentLinkRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PaymentLinkRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(records: Record<string, PaymentLinkRecord>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Quota exceeded or storage disabled — silently drop. UI still works.
  }
}

/**
 * Record a newly-generated link as `pending`. Idempotent: if the same payload
 * was already stored, the existing record is returned untouched.
 */
export function rememberPaymentLink(
  payload: PaymentLinkPayload,
  url: string,
): PaymentLinkRecord {
  const id = paymentLinkId(payload);
  const all = readAll();
  if (all[id]) return all[id];
  const record: PaymentLinkRecord = {
    id,
    payload,
    url,
    status: "pending",
    createdAt: Date.now(),
  };
  all[id] = record;
  writeAll(all);
  return record;
}

/**
 * Resolve the current status of a link, accounting for expiry on read.
 * Returns `null` for links that were never recorded locally — callers that
 * don't have a local record (e.g. payer on a different device) should still
 * honour the on-link `validUntil`.
 */
export function getPaymentLinkRecord(
  payload: PaymentLinkPayload,
): PaymentLinkRecord | null {
  const id = paymentLinkId(payload);
  const all = readAll();
  const existing = all[id];
  if (!existing) return null;

  if (existing.status === "pending") {
    const expired =
      payload.validUntil != null && Date.now() > payload.validUntil;
    if (expired) {
      existing.status = "expired";
      all[id] = existing;
      writeAll(all);
    }
  }
  return existing;
}

/**
 * Mark a link as redeemed once the payer's transaction hash is known.
 * Returns true if the link transitioned to `redeemed`, false if it was
 * already redeemed or expired (and therefore cannot be reused).
 */
export function markPaymentLinkRedeemed(
  payload: PaymentLinkPayload,
  txHash: string,
): boolean {
  const id = paymentLinkId(payload);
  const all = readAll();
  const existing = all[id];
  if (!existing) return false;
  if (existing.status !== "pending") return false;
  existing.status = "redeemed";
  existing.redeemedAt = Date.now();
  existing.redeemedTxHash = txHash;
  all[id] = existing;
  writeAll(all);
  return true;
}

/**
 * List recorded links most recent first. Status is materialized on read so
 * stale `pending` records past their expiry surface as `expired` to the UI.
 */
export function listPaymentLinks(): PaymentLinkRecord[] {
  const all = readAll();
  const records = Object.values(all).map((record) => {
    if (
      record.status === "pending" &&
      record.payload.validUntil != null &&
      Date.now() > record.payload.validUntil
    ) {
      return { ...record, status: "expired" as const };
    }
    return record;
  });
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Returns true if a link in `pending` (or never-recorded) state can still be
 * paid. Used by pay.tsx to block reuse after redemption.
 */
export function canRedeemPaymentLink(
  payload: PaymentLinkPayload,
): { ok: true } | { ok: false; reason: "expired" | "redeemed" } {
  if (payload.validUntil != null && Date.now() > payload.validUntil) {
    return { ok: false, reason: "expired" };
  }
  const record = getPaymentLinkRecord(payload);
  if (record?.status === "redeemed") {
    return { ok: false, reason: "redeemed" };
  }
  if (record?.status === "expired") {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/** Test/dev helper — wipes the local store. */
export function clearPaymentLinkStore(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

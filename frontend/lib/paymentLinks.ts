/**
 * @file lib/paymentLinks.ts
 * @description Status tracking and one-shot redemption for shareable payment
 * request links (#157).
 *
 * The link payload itself is encoded in the URL (see PaymentLinkGenerator —
 * `?data=<base64>`). This module is the local source of truth for *what state
 * a link is in* — `pending`, `redeemed`, or `expired`. Until we wire backend
 * persistence, it lives in `localStorage` keyed by a deterministic id derived
 * from the payload, so the issuer's "My links" view and the payer's pay page
 * agree on whether a link has been used yet.
 */

const STORAGE_KEY = 'micropay.paymentLinks.v1';

export type PaymentLinkStatus = 'pending' | 'redeemed' | 'expired';

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

/**
 * Stable id for a link payload. Hash-only — does not include a timestamp,
 * so re-encoding the same payload yields the same id and prevents accidental
 * duplicates in the local store.
 */
export function paymentLinkId(payload: PaymentLinkPayload): string {
   const canonical = JSON.stringify({
      destination: payload.destination.trim(),
      amount: String(payload.amount).trim(),
      memo: payload.memo?.trim() || '',
      validUntil: payload.validUntil ?? null,
   });
   // Cheap stable hash — fnv-1a 32-bit. Not crypto, just a deterministic key.
   let hash = 0x811c9dc5;
   for (let i = 0; i < canonical.length; i += 1) {
      hash ^= canonical.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
   }
   return `pl_${hash.toString(16).padStart(8, '0')}`;
}

function readAll(): Record<string, PaymentLinkRecord> {
   if (typeof window === 'undefined') return {};
   try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, PaymentLinkRecord>;
      return parsed && typeof parsed === 'object' ? parsed : {};
   } catch {
      return {};
   }
}

function writeAll(records: Record<string, PaymentLinkRecord>): void {
   if (typeof window === 'undefined') return;
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
   url: string
): PaymentLinkRecord {
   const id = paymentLinkId(payload);
   const all = readAll();
   if (all[id]) return all[id];
   const record: PaymentLinkRecord = {
      id,
      payload,
      url,
      status: 'pending',
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
   payload: PaymentLinkPayload
): PaymentLinkRecord | null {
   const id = paymentLinkId(payload);
   const all = readAll();
   const existing = all[id];
   if (!existing) return null;

   if (existing.status === 'pending') {
      const expired =
         payload.validUntil != null && Date.now() > payload.validUntil;
      if (expired) {
         existing.status = 'expired';
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
   txHash: string
): boolean {
   const id = paymentLinkId(payload);
   const all = readAll();
   const existing = all[id];
   if (!existing) return false;
   if (existing.status !== 'pending') return false;
   existing.status = 'redeemed';
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
   const records = Object.values(all).map(record => {
      if (
         record.status === 'pending' &&
         record.payload.validUntil != null &&
         Date.now() > record.payload.validUntil
      ) {
         return { ...record, status: 'expired' as const };
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
   payload: PaymentLinkPayload
): { ok: true } | { ok: false; reason: 'expired' | 'redeemed' } {
   if (payload.validUntil != null && Date.now() > payload.validUntil) {
      return { ok: false, reason: 'expired' };
   }
   const record = getPaymentLinkRecord(payload);
   if (record?.status === 'redeemed') {
      return { ok: false, reason: 'redeemed' };
   }
   if (record?.status === 'expired') {
      return { ok: false, reason: 'expired' };
   }
   return { ok: true };
}

/** Test/dev helper — wipes the local store. */
export function clearPaymentLinkStore(): void {
   if (typeof window === 'undefined') return;
   try {
      window.localStorage.removeItem(STORAGE_KEY);
   } catch {
      // ignore
   }
}

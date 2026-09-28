/**
 * components/AddUsdcTrustline.tsx
 * One-click "Add USDC" button (#1069).
 *
 * If the connected wallet has no USDC trustline (checked via
 * GET /api/accounts/:publicKey/has-usdc-trustline), this component shows a
 * button that builds a changeTrust transaction, asks Freighter to sign it,
 * and submits it — after which the USDC balance appears on the dashboard.
 */

import { useCallback, useEffect, useState } from "react";
import {
  USDC_ISSUER,
  buildChangeTrustTransaction,
  submitTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";

interface AddUsdcTrustlineProps {
  publicKey: string | null;
  onTrustlineAdded?: () => void;
}

export default function AddUsdcTrustline({
  publicKey,
  onTrustlineAdded,
}: AddUsdcTrustlineProps) {
  const [hasTrustline, setHasTrustline] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkTrustline = useCallback(async () => {
    if (!publicKey) {
      setHasTrustline(null);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      const res = await fetch(
        `${apiBase}/api/accounts/${encodeURIComponent(
          publicKey
        )}/has-usdc-trustline`
      );
      if (!res.ok) throw new Error(`Trustline check failed: ${res.status}`);
      const payload = await res.json();
      setHasTrustline(Boolean(payload?.hasTrustline));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trustline check failed.");
      setHasTrustline(null);
    } finally {
      setChecking(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void checkTrustline();
  }, [checkTrustline]);

  const handleAddUsdc = useCallback(async () => {
    if (!publicKey || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const tx = await buildChangeTrustTransaction({
        fromPublicKey: publicKey,
        assetCode: "USDC",
        issuer: USDC_ISSUER,
      });
      const { signedXDR, error: signError } = await signTransactionWithWallet(
        tx.toXDR()
      );
      if (signError || !signedXDR) {
        throw new Error(signError || "Freighter signing failed.");
      }
      await submitTransaction(signedXDR);
      setHasTrustline(true);
      onTrustlineAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add USDC failed.");
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, submitting, onTrustlineAdded]);

  if (!publicKey || checking || hasTrustline !== false) {
    return null;
  }

  return (
    <div
      className="card mb-6 border-blue-500/30 bg-blue-500/5"
      data-testid="add-usdc-trustline"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="font-semibold text-white mb-1">Enable USDC</p>
          <p className="text-sm text-slate-400">
            Your wallet doesn&apos;t trust USDC yet. Add the trustline to see
            your USDC balance here.
          </p>
          {error && (
            <p className="text-sm text-red-300 mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleAddUsdc()}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm py-2 px-4 rounded-lg transition-colors cursor-pointer"
        >
          {submitting ? "Adding USDC…" : "Add USDC"}
        </button>
      </div>
    </div>
  );
}

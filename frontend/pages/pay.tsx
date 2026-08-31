/**
 * pages/pay.tsx
 * The landing page for shareable payment links.
 * Validates expiration, handles errors, and pre-fills the payment form.
 */
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import SendPaymentForm from "@/components/SendPaymentForm";
import WalletConnect from "@/components/WalletConnect";
import { getXLMBalance, getContractTipTotal, CONTRACT_ID } from "@/lib/stellar";
import { formatStroopsToXLM } from "@/utils/format";
import {
  canRedeemPaymentLink,
  markPaymentLinkRedeemed,
  parsePaymentLinkQuery,
} from "@/lib/paymentLinks";
import { useWallet } from "@/lib/useWallet";

interface PrefillData {
  destination: string;
  amount: string;
  memo?: string;
  validUntil?: number | null;
}

export default function PayPage() {
  const { publicKey } = useWallet();
  const router = useRouter();

  const [prefill, setPrefill] = useState<PrefillData | null>(null);
  const [xlmBalance, setXlmBalance] = useState<string>("0");
  const [tipTotal, setTipTotal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiredRequest, setExpiredRequest] = useState<PrefillData | null>(null);

  // Step 1: Parse and validate URL payment details.
  useEffect(() => {
    if (!router.isReady) return;

    const hasPaymentQuery = [
      "data",
      "to",
      "amount",
      "memo",
      "expires",
      "expiry",
      "validUntil",
    ].some((key) => router.query[key] != null);

    if (!hasPaymentQuery) {
      setPrefill(null);
      setError(null);
      return;
    }

    const parsed = parsePaymentLinkQuery(router.query);
    if (!parsed.ok) {
      setPrefill(null);
      setError(
        parsed.reason === "invalid-expiry"
          ? "The payment link expiry timestamp is invalid."
          : parsed.reason === "missing"
            ? "The payment link data is incomplete or malformed."
            : "Invalid payment link. Please check the URL.",
      );
      return;
    }

    // Reuse guard (#157): block links that have already been redeemed
    // on this device. Expiry is also checked centrally immediately before
    // the request can be paid.
    const redeemable = canRedeemPaymentLink(parsed.payload);
    if (!redeemable.ok) {
      if (redeemable.reason === "expired") {
        // Show the original request as read-only so the user can see what
        // was requested even though they can no longer pay it.
        setPrefill(null);
        setExpiredRequest(parsed.payload);
      } else {
        setPrefill(null);
        setExpiredRequest(null);
        setError("This payment link has already been redeemed.");
      }
      return;
    }

    setPrefill(parsed.payload);
    setExpiredRequest(null);
    setError(null);
  }, [router.isReady, router.query]);

  // Keep long-open payment request pages from being submitted after expiry.
  useEffect(() => {
    if (!prefill?.validUntil) return;

    const msUntilExpiry = prefill.validUntil - Date.now();
    if (msUntilExpiry <= 0) {
      setPrefill(null);
      setError("This payment link has expired.");
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setExpiredRequest(prefill);
      setPrefill(null);
    }, msUntilExpiry);

    return () => window.clearTimeout(timeoutId);
  }, [prefill?.validUntil]);

  // Step 2: Fetch balance if wallet is connected
  useEffect(() => {
    if (publicKey) {
      getXLMBalance(publicKey)
        .then(setXlmBalance)
        .catch(() => setXlmBalance("0"));
    }
  }, [publicKey]);

  // Step 3: Fetch recipient's tip total
  useEffect(() => {
    if (prefill?.destination && CONTRACT_ID) {
      getContractTipTotal(prefill.destination)
        .then(setTipTotal)
        .catch(() => setTipTotal("0"));
    }
  }, [prefill?.destination]);

  // UI: Expired request read-only view
  if (expiredRequest) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 card border-amber-500/30 animate-fade-in bg-cosmos-900/50">
        <div className="bg-amber-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">⏰</span>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">
          Payment Link Expired
        </h2>
        <p className="text-slate-400 mb-6">
          This payment request has expired and can no longer be completed.
        </p>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3 text-left">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Destination</p>
            <p className="text-sm font-mono text-white break-all">{expiredRequest.destination}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Amount</p>
            <p className="text-sm font-semibold text-white">{expiredRequest.amount} XLM</p>
          </div>
          {expiredRequest.memo && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Memo</p>
              <p className="text-sm text-slate-200">{expiredRequest.memo}</p>
            </div>
          )}
          {expiredRequest.validUntil != null && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Expired At</p>
              <p className="text-sm text-amber-300">{new Date(expiredRequest.validUntil).toLocaleString()}</p>
            </div>
          )}
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="btn-secondary w-full py-2 mt-6"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  // UI: Error State (Graceful Degradation)
  if (error) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 card border-red-500/30 text-center animate-fade-in bg-cosmos-900/50">
        <div className="bg-red-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl text-red-500">⚠️</span>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">
          Payment Unavailable
        </h2>
        <p className="text-slate-400 mb-6">{error}</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="btn-secondary w-full py-2"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 animate-fade-in">
      <div className="text-center mb-10">
        <h1 className="font-display text-3xl font-bold text-white mb-3">
          Complete Payment
        </h1>
        <p className="text-slate-400">
          {publicKey
            ? "Review the details below to authorize the transaction."
            : "You’ve received a payment request. Connect your wallet to proceed."}
        </p>

        {tipTotal !== null && CONTRACT_ID && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-stellar-500/10 border border-stellar-500/20">
            <span className="text-xs font-medium text-stellar-400">
              {`Recipient's Total Tips Recorded:`}
            </span>
            <span className="text-xs font-bold text-white">
              {formatStroopsToXLM(tipTotal)}
            </span>
          </div>
        )}
      </div>

      {!publicKey ? (
        <div className="card border-stellar-500/20 bg-cosmos-900/50">
          <WalletConnect />
        </div>
      ) : (
        <div className="animate-slide-up">
          <SendPaymentForm
            publicKey={publicKey}
            xlmBalance={xlmBalance}
            prefill={prefill}
            onSuccess={(txHash) => {
              if (prefill && txHash) {
                // Mark the link as redeemed so the issuer's "My links" view
                // updates and any future visit to this URL is blocked (#157).
                markPaymentLinkRedeemed(prefill, txHash);
              }
              // Redirect to transactions after success
              setTimeout(() => router.push("/transactions"), 3000);
            }}
          />
        </div>
      )}
    </div>
  );
}

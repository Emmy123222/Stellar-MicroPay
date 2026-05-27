/**
 * components/MultiSigFlow.tsx
 *
 * Multi-signature payment flow for high-value transactions.
 *
 * How it works:
 *  1. Build  — initiator fills in destination, amount, memo, and required
 *              signature threshold (≥ 2). Triggered automatically when the
 *              payment amount exceeds MULTISIG_THRESHOLD_XLM.
 *  2. Sign   — initiator signs first with their own Freighter wallet.
 *  3. Share  — a shareable URL containing the unsigned XDR is generated so
 *              co-signers can open /multi-sig-sign in their own browser.
 *  4. Collect — initiator pastes each co-signer's signed XDR back in.
 *              Signature hints are shown so the initiator can verify who signed.
 *  5. Submit — once the threshold is met the combined XDR is submitted to
 *              Stellar Horizon.
 *
 * Stellar multi-sig reference:
 *  https://developers.stellar.org/docs/learn/encyclopedia/security/signatures-multisig
 */

import { useState, useCallback } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import clsx from "clsx";
import {
  buildPaymentTransaction,
  collectSignatures,
  submitTransaction,
  isValidStellarAddress,
  NETWORK_PASSPHRASE,
} from "../lib/stellar";
import { signTransactionWithWallet } from "../lib/wallet";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Payments at or above this amount (XLM) will surface the multi-sig UI. */
export const MULTISIG_THRESHOLD_XLM = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "build" | "sign" | "share" | "collect" | "submit" | "success";

interface MultiSigFlowProps {
  publicKey: string;
  xlmBalance: string;
  /** Pre-fill from SendPaymentForm when amount exceeds threshold. */
  prefill?: { destination: string; amount: string; memo?: string } | null;
  onSuccess?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the last-4-byte hint (hex) from each signature in a signed XDR. */
function extractHints(signedXDRs: string[]): string[] {
  const hints: string[] = [];
  for (const xdr of signedXDRs) {
    try {
      const tx = new Transaction(xdr, NETWORK_PASSPHRASE);
      for (const sig of tx.signatures) {
        hints.push(Buffer.from(sig.hint()).toString("hex"));
      }
    } catch {
      // skip malformed XDR
    }
  }
  return hints;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MultiSigFlow({
  publicKey,
  xlmBalance,
  prefill,
  onSuccess,
}: MultiSigFlowProps) {
  const [step, setStep] = useState<Step>("build");

  // Build step
  const [destination, setDestination] = useState(prefill?.destination ?? "");
  const [amount, setAmount] = useState(prefill?.amount ?? "");
  const [memo, setMemo] = useState(prefill?.memo ?? "");
  const [threshold, setThreshold] = useState(2);

  // Transaction state
  const [unsignedXDR, setUnsignedXDR] = useState<string | null>(null);
  const [initiatorSignedXDR, setInitiatorSignedXDR] = useState<string | null>(null);
  const [cosignerXDRs, setCosignerXDRs] = useState<string[]>([]);
  const [pastedXDR, setPastedXDR] = useState("");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [xdrCopied, setXdrCopied] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const balance = parseFloat(xlmBalance);
  const amountNum = parseFloat(amount);
  const isValidDest = isValidStellarAddress(destination);
  const isValidAmt = !isNaN(amountNum) && amountNum > 0 && amountNum <= balance;
  const canBuild = isValidDest && isValidAmt && threshold >= 2;

  // Total signatures = initiator + co-signers
  const allSignedXDRs = initiatorSignedXDR
    ? [initiatorSignedXDR, ...cosignerXDRs]
    : cosignerXDRs;
  const signaturesCollected = allSignedXDRs.length;
  const thresholdMet = signaturesCollected >= threshold;

  // ── Step 1: Build ──────────────────────────────────────────────────────────

  const handleBuild = async () => {
    if (!canBuild) return;
    setLoading(true);
    setError(null);
    try {
      const tx = await buildPaymentTransaction({
        fromPublicKey: publicKey,
        toPublicKey: destination,
        amount: amountNum.toFixed(7),
        memo: memo.trim() || undefined,
      });
      setUnsignedXDR(tx.toXDR());
      setStep("sign");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to build transaction");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Initiator signs first ─────────────────────────────────────────

  const handleInitiatorSign = async () => {
    if (!unsignedXDR) return;
    setLoading(true);
    setError(null);
    try {
      const { signedXDR, error: signError } = await signTransactionWithWallet(unsignedXDR);
      if (signError || !signedXDR) throw new Error(signError || "Signing rejected");
      setInitiatorSignedXDR(signedXDR);
      setStep("share");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Signing failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: Share URL ──────────────────────────────────────────────────────

  const shareableUrl =
    typeof window !== "undefined" && unsignedXDR
      ? `${window.location.origin}/multi-sig-sign?xdr=${encodeURIComponent(unsignedXDR)}`
      : "";

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(shareableUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Step 4: Collect co-signer XDRs ────────────────────────────────────────

  const handleAddCosignerXDR = () => {
    const trimmed = pastedXDR.trim();
    if (!trimmed) return;
    // Basic validation — must parse as a Transaction
    try {
      new Transaction(trimmed, NETWORK_PASSPHRASE);
    } catch {
      setError("Invalid signed XDR — please paste the full string from the co-signer.");
      return;
    }
    setCosignerXDRs((prev) => [...prev, trimmed]);
    setPastedXDR("");
    setError(null);
  };

  const handleRemoveCosignerXDR = (index: number) => {
    setCosignerXDRs((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Step 5: Submit ─────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!unsignedXDR || !thresholdMet) return;
    setLoading(true);
    setError(null);
    try {
      const combinedXDR = await collectSignatures(unsignedXDR, allSignedXDRs);
      const result = await submitTransaction(combinedXDR);
      setTxHash(result.hash);
      setStep("success");
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setStep("build");
    setDestination(prefill?.destination ?? "");
    setAmount(prefill?.amount ?? "");
    setMemo(prefill?.memo ?? "");
    setThreshold(2);
    setUnsignedXDR(null);
    setInitiatorSignedXDR(null);
    setCosignerXDRs([]);
    setPastedXDR("");
    setError(null);
    setTxHash(null);
  };

  const STEPS: Step[] = ["build", "sign", "share", "collect", "submit"];
  const stepIndex = STEPS.indexOf(step === "success" ? "submit" : step);

  const stepLabels: Record<Step, string> = {
    build: "Build",
    sign: "Sign",
    share: "Share",
    collect: "Collect",
    submit: "Submit",
    success: "Submit",
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="card animate-fade-in border-stellar-400/20">
      <h2 className="font-display text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <MultiSigIcon className="w-5 h-5 text-stellar-400" />
        Multi-Signature Payment
      </h2>
      <p className="text-xs text-slate-500 mb-5">
        Requires {threshold} signatures before funds are released.
        {amountNum >= MULTISIG_THRESHOLD_XLM && (
          <span className="ml-1 text-amber-400">
            High-value payment detected (≥ {MULTISIG_THRESHOLD_XLM} XLM).
          </span>
        )}
      </p>

      {/* Step indicator */}
      <div className="flex items-center mb-6 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center flex-shrink-0">
            <div
              className={clsx(
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                i < stepIndex
                  ? "bg-stellar-500 text-black"
                  : i === stepIndex
                  ? "bg-stellar-400 text-black ring-2 ring-stellar-400/30"
                  : "bg-white/10 text-slate-500"
              )}
            >
              {i < stepIndex ? <CheckSmallIcon className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span
              className={clsx(
                "ml-1 text-xs hidden sm:block",
                i === stepIndex ? "text-stellar-300" : "text-slate-500"
              )}
            >
              {stepLabels[s]}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={clsx(
                  "w-6 h-px mx-2",
                  i < stepIndex ? "bg-stellar-500" : "bg-white/10"
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* ── Step: Build ── */}
      {step === "build" && (
        <div className="space-y-4">
          <div>
            <label className="label">Recipient Address</label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="G..."
              className={clsx("input-field font-mono text-sm", destination && !isValidDest && "border-red-500/50")}
            />
          </div>
          <div>
            <label className="label">Amount (XLM)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              min="0"
              step="0.0000001"
              className={clsx("input-field", amount && !isValidAmt && "border-red-500/50")}
            />
            {amountNum >= MULTISIG_THRESHOLD_XLM && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <WarnIcon className="w-3.5 h-3.5 flex-shrink-0" />
                High-value payment — multi-sig required.
              </p>
            )}
          </div>
          <div>
            <label className="label">Memo (optional)</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Payment description"
              className="input-field"
            />
          </div>
          <div>
            <label className="label">
              Required Signatures
              <span className="ml-1 text-slate-500 font-normal">(minimum 2)</span>
            </label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Math.max(2, parseInt(e.target.value) || 2))}
              min="2"
              className="input-field"
            />
          </div>
          <button
            onClick={handleBuild}
            disabled={!canBuild || loading}
            className="btn-primary w-full py-2.5 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner /> : null}
            {loading ? "Building..." : "Build Transaction"}
          </button>
        </div>
      )}

      {/* ── Step: Sign (initiator) ── */}
      {step === "sign" && (
        <div className="space-y-4">
          <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-2 text-sm">
            <Row label="To" value={destination} mono />
            <Row label="Amount" value={`${amountNum.toFixed(7)} XLM`} />
            {memo && <Row label="Memo" value={memo} />}
            <Row label="Threshold" value={`${threshold} signatures`} />
          </div>
          <p className="text-slate-400 text-sm">
            Sign first with your own Freighter wallet. Co-signers will add their signatures next.
          </p>
          <button
            onClick={handleInitiatorSign}
            disabled={loading}
            className="btn-primary w-full py-2.5 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner /> : <FreighterIcon className="w-4 h-4" />}
            {loading ? "Waiting for Freighter..." : "Sign with Freighter"}
          </button>
          <button onClick={handleReset} className="text-xs text-slate-500 hover:text-slate-300 w-full text-center transition-colors">
            ← Start over
          </button>
        </div>
      )}

      {/* ── Step: Share ── */}
      {step === "share" && (
        <div className="space-y-4">
          <p className="text-slate-300 text-sm">
            Your signature has been added. Share this link with your co-signers so they can sign in their own browser.
          </p>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wider">Co-signer URL</p>
            <p className="font-mono text-xs text-slate-300 break-all">{shareableUrl}</p>
          </div>
          <button
            onClick={handleCopyUrl}
            className="btn-secondary w-full py-2.5 flex items-center justify-center gap-2"
          >
            {copied ? <CheckSmallIcon className="w-4 h-4 text-green-400" /> : <CopyIcon className="w-4 h-4" />}
            {copied ? "Copied!" : "Copy Link"}
          </button>
          <button
            onClick={() => setStep("collect")}
            className="btn-primary w-full py-2.5"
          >
            Collect Co-Signer Signatures →
          </button>
        </div>
      )}

      {/* ── Step: Collect ── */}
      {step === "collect" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-slate-300 text-sm">
              Signatures: <span className="font-bold text-white">{signaturesCollected}</span> / {threshold}
            </p>
            {thresholdMet && (
              <span className="text-xs text-green-400 font-medium">Threshold met ✓</span>
            )}
          </div>

          {/* Signature hints */}
          {allSignedXDRs.length > 0 && (
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-1">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Collected Signatures</p>
              {extractHints(allSignedXDRs).map((hint, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    {i === 0 ? "You (initiator)" : `Co-signer ${i}`}
                  </span>
                  <code className="text-xs text-stellar-300 font-mono">{hint}</code>
                  {i > 0 && (
                    <button
                      onClick={() => handleRemoveCosignerXDR(i - 1)}
                      className="text-red-400 hover:text-red-300 text-xs ml-2"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!thresholdMet && (
            <>
              <div>
                <label className="label">Paste Signed XDR from Co-Signer</label>
                <textarea
                  value={pastedXDR}
                  onChange={(e) => setPastedXDR(e.target.value)}
                  placeholder="AAAA..."
                  className="input-field h-24 font-mono text-xs"
                />
              </div>
              <button
                onClick={handleAddCosignerXDR}
                disabled={!pastedXDR.trim()}
                className="btn-secondary w-full py-2.5"
              >
                Add Signature
              </button>
            </>
          )}

          {thresholdMet && (
            <button
              onClick={() => setStep("submit")}
              className="btn-primary w-full py-2.5"
            >
              Proceed to Submit →
            </button>
          )}
        </div>
      )}

      {/* ── Step: Submit ── */}
      {step === "submit" && (
        <div className="space-y-4">
          <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-2 text-sm">
            <Row label="To" value={destination} mono />
            <Row label="Amount" value={`${amountNum.toFixed(7)} XLM`} />
            {memo && <Row label="Memo" value={memo} />}
            <Row label="Signatures" value={`${signaturesCollected} / ${threshold}`} />
          </div>
          <p className="text-slate-400 text-sm">
            All required signatures have been collected. Submit the transaction to the Stellar network.
          </p>
          <button
            onClick={handleSubmit}
            disabled={loading || !thresholdMet}
            className="btn-primary w-full py-2.5 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner /> : null}
            {loading ? "Submitting..." : "Submit to Stellar Network"}
          </button>
          <button onClick={() => setStep("collect")} className="text-xs text-slate-500 hover:text-slate-300 w-full text-center transition-colors">
            ← Back to signatures
          </button>
        </div>
      )}

      {/* ── Step: Success ── */}
      {step === "success" && txHash && (
        <div className="text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
            <CheckSmallIcon className="w-7 h-7 text-green-400" />
          </div>
          <p className="font-display text-lg font-semibold text-white">Transaction submitted!</p>
          <p className="text-slate-400 text-sm">
            The multi-signature payment has been confirmed on the Stellar network.
          </p>
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary w-full py-2.5 flex items-center justify-center gap-2"
          >
            View on Explorer <ExternalLinkIcon className="w-4 h-4" />
          </a>
          <button onClick={handleReset} className="btn-primary w-full py-2.5">
            New Multi-Sig Payment
          </button>
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm mt-4 flex items-start gap-1.5">
          <WarnIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-400 flex-shrink-0">{label}</span>
      <span className={clsx("text-slate-200 text-right break-all", mono && "font-mono text-xs")}>
        {value}
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function MultiSigIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

function CheckSmallIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function FreighterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18-3a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3m18-3V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6m18 0v3M3 9h18" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

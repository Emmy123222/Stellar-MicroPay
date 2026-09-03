/**
 * components/MultiSigFlow.tsx
 * Multi-signature transaction workflow component.
 */

import { useState } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "../lib/stellar";
// Helper to extract signature hints (last 4 bytes of public key) from signed XDRs
function getSignerHints(unsignedXDR: string, signedXDRs: string[]): string[] {
  try {
    const hints: string[] = [];
    for (const sxdr of signedXDRs) {
      const tx = new Transaction(sxdr, NETWORK_PASSPHRASE);
      for (const sig of tx.signatures) {
        hints.push(Buffer.from(sig.hint()).toString("hex"));
      }
    }
    return hints;
  } catch {
    return [];
  }
}
import clsx from "clsx";
import {
  buildPaymentTransaction,
  collectSignatures,
  submitTransaction,
  isValidStellarAddress,
} from "../lib/stellar";
import { signTransactionWithWallet } from "../lib/wallet";
import { formatXLM } from "../utils/format";

interface MultiSigFlowProps {
  publicKey: string;
  xlmBalance: string;
  onSuccess?: () => void;
}

type Step = "build" | "share" | "collect" | "submit";

export default function MultiSigFlow({ publicKey, xlmBalance, onSuccess }: MultiSigFlowProps) {
  const [step, setStep] = useState<Step>("build");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [threshold, setThreshold] = useState(2);
  const [unsignedXDR, setUnsignedXDR] = useState<string | null>(null);
  const [signedXDRs, setSignedXDRs] = useState<string[]>([]);
  const [newSignedXDR, setNewSignedXDR] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const amountNum = parseFloat(amount);
  const balance = parseFloat(xlmBalance);
  const isValidDest = isValidStellarAddress(destination);
  const isValidAmt = !isNaN(amountNum) && amountNum > 0 && amountNum <= balance;
  const canBuild = isValidDest && isValidAmt && threshold >= 2;

  const handleBuild = async () => {
    if (!canBuild) return;
    setStatus("loading");
    setError(null);
    try {
      const tx = await buildPaymentTransaction({
        fromPublicKey: publicKey,
        toPublicKey: destination,
        amount: amountNum.toFixed(7),
        memo: memo.trim() || undefined,
      });
      setUnsignedXDR(tx.toXDR());
      setStep("share");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to build transaction");
    } finally {
      setStatus("idle");
    }
  };

  const shareableUrl = unsignedXDR
    ? `${window.location.origin}/multi-sig-sign?xdr=${encodeURIComponent(unsignedXDR)}`
    : "";

  const handleAddSignature = () => {
    if (!newSignedXDR.trim()) return;
    setSignedXDRs(prev => [...prev, newSignedXDR.trim()]);
    setNewSignedXDR("");
  };

  const handleSubmit = async () => {
    if (signedXDRs.length < threshold || !unsignedXDR) return;
    setStatus("loading");
    setError(null);
    try {
      const combinedXDR = await collectSignatures(unsignedXDR, signedXDRs);
      // Sign with initiator's wallet if needed
      const { signedXDR, error: signError } = await signTransactionWithWallet(combinedXDR);
      if (signError || !signedXDR) {
        setError(signError || "Failed to sign transaction");
        setStatus("idle");
        return;
      }
      const result = await submitTransaction(signedXDR);
      onSuccess?.();
      setStep("build"); // Reset
      // Maybe show success
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit transaction");
    } finally {
      setStatus("idle");
    }
  };

  return (
    <div className="card animate-fade-in border-stellar-400/20">
      <h2 className="font-display text-lg font-semibold text-white mb-6 flex items-center gap-2">
        <MultiSigIcon className="w-5 h-5 text-stellar-400" />
        Multi-Signature Transaction
      </h2>

      {/* Step Indicator */}
      <div className="flex items-center mb-6">
        {["build", "share", "collect", "submit"].map((s, i) => (
          <div key={s} className="flex items-center">
            <div
              className={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold",
                step === s ? "bg-stellar-500 text-black" : signedXDRs.length >= threshold && i === 3 ? "bg-green-500 text-white" : "bg-white/10 text-slate-400"
              )}
            >
              {i + 1}
            </div>
            {i < 3 && <div className="w-8 h-0.5 bg-white/10 mx-2" />}
          </div>
        ))}
      </div>

      {step === "build" && (
        <div className="space-y-4">
          <div>
            <label className="label">Recipient Address</label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="G..."
              className="input-field"
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
              className="input-field"
            />
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
            <label className="label">Signature Threshold</label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value) || 2)}
              min="2"
              className="input-field"
            />
          </div>
          <button
            onClick={handleBuild}
            disabled={!canBuild || status === "loading"}
            className="btn-primary w-full py-2.5"
          >
            {status === "loading" ? "Building..." : "Build Transaction"}
          </button>
        </div>
      )}

      {step === "share" && (
        <div className="space-y-4">
          <p className="text-slate-300">Share this URL with your co-signers:</p>
          <input
            type="text"
            value={shareableUrl}
            readOnly
            className="input-field"
          />
          <button
            onClick={() => navigator.clipboard.writeText(shareableUrl)}
            className="btn-secondary w-full py-2.5"
          >
            Copy URL
          </button>
          <button
            onClick={() => setStep("collect")}
            className="btn-primary w-full py-2.5 mt-4"
          >
            Proceed to Collect Signatures
          </button>
        </div>
      )}

      {step === "collect" && (
        <div className="space-y-4">
          <p className="text-slate-300">
            Signatures collected: {signedXDRs.length} / {threshold}
          </p>
          {unsignedXDR && signedXDRs.length > 0 && (
            <ul className="text-xs text-slate-400">
              {getSignerHints(unsignedXDR, signedXDRs).map((hint, i) => (
                <li key={i}>Signature {i + 1} hint: {hint}</li>
              ))}
            </ul>
          )}
          <div>
            <label className="label">Paste Signed XDR from Co-Signer</label>
            <textarea
              value={newSignedXDR}
              onChange={(e) => setNewSignedXDR(e.target.value)}
              placeholder="AAAA..."
              className="input-field h-24"
            />
          </div>
          <button
            onClick={handleAddSignature}
            disabled={!newSignedXDR.trim()}
            className="btn-secondary w-full py-2.5"
          >
            Add Signature
          </button>
          {signedXDRs.length >= threshold && (
            <button
              onClick={() => setStep("submit")}
              className="btn-primary w-full py-2.5 mt-4"
            >
              Proceed to Submit
            </button>
          )}
        </div>
      )}

      {step === "submit" && (
        <div className="space-y-4">
          <p className="text-slate-300">
            Ready to submit with {signedXDRs.length} signatures.
          </p>
          {unsignedXDR && signedXDRs.length > 0 && (
            <ul className="text-xs text-slate-400">
              {getSignerHints(unsignedXDR, signedXDRs).map((hint, i) => (
                <li key={i}>Signature {i + 1} hint: {hint}</li>
              ))}
            </ul>
          )}
          <button
            onClick={handleSubmit}
            disabled={status === "loading"}
            className="btn-primary w-full py-2.5"
          >
            {status === "loading" ? "Submitting..." : "Submit Transaction"}
          </button>
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm mt-4">{error}</p>
      )}
    </div>
  );
}

function MultiSigIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}
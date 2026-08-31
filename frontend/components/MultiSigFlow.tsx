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

import { useState, useCallback, useEffect, useRef, useId } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import clsx from "clsx";
import {
  buildPaymentTransaction,
  collectSignatures,
  submitTransaction,
  isValidStellarAddress,
  NETWORK_PASSPHRASE,
  getNetworkConfig,
} from "../lib/stellar";
import { signTransactionWithWallet } from "../lib/wallet";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Payments at or above this amount (XLM) will surface the multi-sig UI. */
export const MULTISIG_THRESHOLD_XLM = 100;

/** Configurable delay for signature reminder (in milliseconds) */
const REMINDER_DELAY_MS = parseInt(process.env.NEXT_PUBLIC_MULTISIG_REMINDER_DELAY_MS || "300000"); // Default 5 minutes

/** Draft expiry TTL (24 hours) */
const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────----

type Step = "build" | "sign" | "share" | "collect" | "submit" | "success";

/** Ordered wizard steps exposed for tests and Storybook (#825). */
export const MULTISIG_FLOW_STEPS = ["build", "sign", "share", "collect", "submit"] as const;
export type MultiSigFlowStep = (typeof MULTISIG_FLOW_STEPS)[number];

const STEP_LABELS: Record<MultiSigFlowStep, string> = {
  build: "Build",
  sign: "Sign",
  share: "Share",
  collect: "Collect",
  submit: "Submit",
};

function activeStepIndex(step: Step): number {
  const active = step === "success" ? "submit" : step;
  return MULTISIG_FLOW_STEPS.indexOf(active as MultiSigFlowStep);
}

interface MultiSigFlowProps {
  publicKey: string;
  xlmBalance: string;
  /** Pre-fill from SendPaymentForm when amount exceeds threshold. */
  prefill?: { destination: string; amount: string; memo?: string } | null;
  onSuccess?: () => void;
  /** Optional array of co-signer public keys for reminder tracking */
  cosigners?: string[];
  /** Initial wizard step (defaults to "build"). Useful for Storybook previews. */
  defaultStep?: Step;
  /** Initial required signature threshold (defaults to 2). */
  defaultThreshold?: number;
  /** Initial initiator signed XDR for collect/submit previews. */
  defaultInitiatorSignedXDR?: string | null;
  /** Initial co-signer signed XDRs for collect/submit previews. */
  defaultCosignerXDRs?: string[];
}

interface MultiSigDraft {
  step: Step;
  destination: string;
  amount: string;
  memo: string;
  threshold: number;
  unsignedXDR: string | null;
  initiatorSignedXDR: string | null;
  cosignerXDRs: string[];
  updatedAt: number;
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

function getDraftStorageKey(publicKey: string): string {
  const network = getNetworkConfig().network;
  return `stellar-micropay:multisig-draft:${network}:${publicKey || "anonymous"}`;
}

export function loadMultiSigDraft(publicKey: string): MultiSigDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getDraftStorageKey(publicKey));
    if (!raw) return null;
    const draft = JSON.parse(raw) as MultiSigDraft;
    if (Date.now() - draft.updatedAt > DRAFT_EXPIRY_MS) {
      localStorage.removeItem(getDraftStorageKey(publicKey));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveMultiSigDraft(publicKey: string, draft: Omit<MultiSigDraft, "updatedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: MultiSigDraft = {
      ...draft,
      updatedAt: Date.now(),
    };
    localStorage.setItem(getDraftStorageKey(publicKey), JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export function clearMultiSigDraft(publicKey: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getDraftStorageKey(publicKey));
  } catch {
    // ignore storage errors
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MultiSigFlow({
  publicKey,
  xlmBalance,
  prefill,
  onSuccess,
  cosigners = [],
  defaultStep,
  defaultThreshold = 2,
  defaultInitiatorSignedXDR = null,
  defaultCosignerXDRs = [],
}: MultiSigFlowProps) {
  // Load persisted draft if available and no explicit defaults override it
  const savedDraft = defaultStep ? null : loadMultiSigDraft(publicKey);

  const [step, setStep] = useState<Step>(defaultStep ?? savedDraft?.step ?? "build");

  // Build step
  const [destination, setDestination] = useState(
    prefill?.destination ?? savedDraft?.destination ?? ""
  );
  const [amount, setAmount] = useState(
    prefill?.amount ?? savedDraft?.amount ?? ""
  );
  const [memo, setMemo] = useState(
    prefill?.memo ?? savedDraft?.memo ?? ""
  );
  const [threshold, setThreshold] = useState(
    savedDraft?.threshold ?? defaultThreshold
  );

  // Transaction state
  const [unsignedXDR, setUnsignedXDR] = useState<string | null>(savedDraft?.unsignedXDR ?? null);
  const [initiatorSignedXDR, setInitiatorSignedXDR] = useState<string | null>(
    savedDraft?.initiatorSignedXDR ?? defaultInitiatorSignedXDR
  );
  const [cosignerXDRs, setCosignerXDRs] = useState<string[]>(
    savedDraft?.cosignerXDRs ?? defaultCosignerXDRs
  );
  const [pastedXDR, setPastedXDR] = useState("");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [xdrCopied, setXdrCopied] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [reminderScheduled, setReminderScheduled] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const stepPanelRef = useRef<HTMLDivElement>(null);
  const stepHeadingId = useId();
  const previousStepRef = useRef<Step>(step);

  // Persist draft on state changes (when step is build, sign, share, or collect)
  useEffect(() => {
    if (step === "success") {
      clearMultiSigDraft(publicKey);
      return;
    }
    if (step === "build" && !destination && !amount && !unsignedXDR) {
      clearMultiSigDraft(publicKey);
      return;
    }
    saveMultiSigDraft(publicKey, {
      step,
      destination,
      amount,
      memo,
      threshold,
      unsignedXDR,
      initiatorSignedXDR,
      cosignerXDRs,
    });
  }, [publicKey, step, destination, amount, memo, threshold, unsignedXDR, initiatorSignedXDR, cosignerXDRs]);

  const handleExplicitDiscard = () => {
    clearMultiSigDraft(publicKey);
    setStep("build");
    setDestination(prefill?.destination ?? "");
    setAmount(prefill?.amount ?? "");
    setMemo(prefill?.memo ?? "");
    setThreshold(defaultThreshold);
    setUnsignedXDR(null);
    setInitiatorSignedXDR(null);
    setCosignerXDRs([]);
    setError(null);
    setTxHash(null);
  };

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
  const stepIndex = activeStepIndex(step);

  const announce = useCallback((message: string) => {
    setLiveMessage(message);
  }, []);

  useEffect(() => {
    if (previousStepRef.current === step) {
      return;
    }
    previousStepRef.current = step;
    const label = step === "success" ? "Complete" : STEP_LABELS[step as MultiSigFlowStep];
    announce(`Step ${stepIndex + 1} of ${MULTISIG_FLOW_STEPS.length}: ${label}`);
    stepPanelRef.current?.focus();
  }, [announce, step, stepIndex]);

  useEffect(() => {
    announce(`Signatures collected: ${signaturesCollected} of ${threshold}`);
  }, [announce, signaturesCollected, threshold]);

  // Step 1: Build Transaction
  const handleBuild = async () => {
    setLoading(true);
    setError(null);
    try {
      const xdrResult = await buildPaymentTransaction({
        publicKey,
        destination,
        amount,
        memo,
      });
      setUnsignedXDR(xdrResult);
      setStep("sign");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to build transaction");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Sign with Initiator Wallet
  const handleSignInitiator = async () => {
    if (!unsignedXDR) return;
    setLoading(true);
    setError(null);
    try {
      const { signedXDR, error: signError } = await signTransactionWithWallet(unsignedXDR);
      if (signError || !signedXDR) {
        setError(signError || "Failed to sign transaction");
        return;
      }
      setInitiatorSignedXDR(signedXDR);
      setStep("share");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Wallet signing failed");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Copy share link / unsigned XDR
  const handleCopyShareLink = () => {
    if (!unsignedXDR) return;
    const shareUrl = `${window.location.origin}/multi-sig-sign?xdr=${encodeURIComponent(unsignedXDR)}&threshold=${threshold}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyXDR = () => {
    if (!unsignedXDR) return;
    navigator.clipboard.writeText(unsignedXDR);
    setXdrCopied(true);
    setTimeout(() => setXdrCopied(false), 2000);
  };

  // Step 4: Add Co-signer XDR
  const handleAddCosignerXDR = () => {
    if (!pastedXDR.trim()) return;
    setError(null);
    try {
      const trimmed = pastedXDR.trim();
      // Basic validation: try instantiating Transaction
      new Transaction(trimmed, NETWORK_PASSPHRASE);
      if (allSignedXDRs.includes(trimmed)) {
        setError("This signed XDR has already been added.");
        return;
      }
      setCosignerXDRs((prev) => [...prev, trimmed]);
      setPastedXDR("");
    } catch {
      setError("Invalid signed transaction XDR.");
    }
  };

  // Step 5: Submit combined XDR
  const handleSubmit = async () => {
    if (!unsignedXDR) return;
    setLoading(true);
    setError(null);
    try {
      const combined = collectSignatures(unsignedXDR, allSignedXDRs);
      const hash = await submitTransaction(combined);
      setTxHash(hash);
      setStep("success");
      clearMultiSigDraft(publicKey);
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit multi-sig transaction");
    } finally {
      setLoading(false);
    }
  };

  // Reminder timer setup
  useEffect(() => {
    if (step === "share" || step === "collect") {
      const timer = setTimeout(() => {
        setReminderScheduled(true);
      }, REMINDER_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const initiatorHints = initiatorSignedXDR ? extractHints([initiatorSignedXDR]) : [];
  const cosignerHints = extractHints(cosignerXDRs);

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Discard Draft Option */}
      {step !== "build" && step !== "success" && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={handleExplicitDiscard}
            className="text-xs text-slate-400 hover:text-red-400 transition-colors"
          >
            Discard draft
          </button>
        </div>
      )}

      {/* Step Progress Stepper */}
      <nav aria-label="Multi-signature payment progress" className="mb-8">
        <ol className="flex items-center justify-between relative">
          {MULTISIG_FLOW_STEPS.map((s, idx) => {
            const isActive = step === s || (step === "success" && s === "submit");
            const isCompleted = stepIndex > idx || step === "success";

            return (
              <li key={s} className="flex flex-col items-center relative z-10">
                <div
                  className={clsx(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all",
                    isActive
                      ? "bg-stellar-500 text-white ring-4 ring-stellar-500/20"
                      : isCompleted
                      ? "bg-emerald-500 text-white"
                      : "bg-white/10 text-slate-400"
                  )}
                  {...(isActive ? { "aria-current": "step" } : {})}
                >
                  {idx + 1}
                },
                <span className={clsx("text-xs mt-1", isActive ? "text-white font-medium" : "text-slate-400")}>
                  {STEP_LABELS[s]}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Live announcement region for accessibility */} 
      <div className="sr-only" aria-live="polite" role="status">
        {liveMessage}
        {`Signatures collected: ${signaturesCollected} of ${threshold}`}
      </div>

      {/* Step Panel */}
      <div
        ref={stepPanelRef}
        tabIndex={-1}
        role="region"
        aria-labelledby={stepHeadingId}
        className="card p-6 outline-none focus:ring-2 focus:ring-stellar-500/50"
      >
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )} 

        {reminderScheduled && (step === "share" || step === "collect") && (
          <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center justify-between">
            <span>Reminder: Co-signer signatures are still pending after {Math.round(REMINDER_DELAY_MS / 60000)} minutes.</span>
            <button
              onClick={() => setReminderScheduled(false)}
              className="text-xs underline text-amber-200 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ── STEP 1: BUILD ─────────────────────────────────────────── */}
        {step === "build" && (
          <div>
            <h3 id={stepHeadingId} className="font-display text-lg font-semibold text-white mb-4">
              Build Multi-Signature Payment
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Recipient Address
                </label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value.trim())}
                  placeholder="G..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-stellar-500"
                />
                {destination && !isValidDest && (
                  <p className="text-xs text-red-400 mt-1">Invalid Stellar address format</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Amount (XLM)
                </label>
                <input
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-stellar-500"
                />
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>Available: {xlmBalance} XLM</span>
                  <span>Threshold: ≥ {MULTISIG_THRESHOLD_XLM} XLM</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Memo (Optional)
                </label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Payment memo"
                  maxLength={28}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-stellar-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Required Signatures Threshold
                </label>
                <input
                  type="number"
                  min="2"
                  max="10"
                  value={threshold}
                  onChange={(e) => setThreshold(parseInt(e.target.value) || 2)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-stellar-500"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Minimum 2 signers required for multi-signature transactions.
                </p>
              </div>

              <button
                type="button"
                disabled={!canBuild || loading}
                onClick={handleBuild}
                className="w-full bg-stellar-500 hover:bg-stellar-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors mt-6"
              >
                {loading ? "Building Transaction..." : "Build Transaction →"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: SIGN ──────────────────────────────────────────── */}
        {step === "sign" && (
          <div>
            <h3 id={stepHeadingId} className="font-display text-lg font-semibold text-white mb-4">
              Sign with Your Wallet
            </h3>
            <p className="text-sm text-slate-300 mb-6">
              Review the transaction details below and sign first with your Freighter wallet.
            </p>

            <div className="bg-white/5 p-4 rounded-xl mb-6 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Destination:</span>
                <span className="font-mono text-white truncate max-w-xs" title={destination}>{destination}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount:</span>
                <span className="font-mono text-white">{amount} XLM</span>
              </div>
              {memo && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Memo:</span>
                  <span className="text-white">{memo}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">Threshold:</span>
                <span className="text-white">{threshold} signatures</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep("build")}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-3 rounded-xl transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleSignInitiator}
                className="flex-1 bg-stellar-500 hover:bg-stellar-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
              >
                {loading ? "Signing..." : "Sign Transaction"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: SHARE ─────────────────────────────────────────── */}
        {step === "share" && (
          <div>
            <h3 id={stepHeadingId} className="font-display text-lg font-semibold text-white mb-4">
              Share with Co-Signers
            </h3>
            <p className="text-sm text-slate-300 mb-6">
              Send the share link or unsigned XDR to your co-signers so they can review and sign the transaction in their own browser.
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Co-Signer Share Link
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={unsignedXDR ? `${typeof window !== "undefined" ? window.location.origin : ""}/multi-sig-sign?xdr=${encodeURIComponent(unsignedXDR)}&threshold=${threshold}` : ""}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white font-mono text-xs focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm transition-colors whitespace-nowrap"
                  >
                    {copied ? "Copied!" : "Copy Link"}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Unsigned Transaction XDR
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={unsignedXDR ?? ""}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white font-mono text-xs focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyXDR}
                    className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm transition-colors whitespace-nowrap"
                  >
                    {xdrCopied ? "Copied!" : "Copy XDR"}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep("sign")}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-3 rounded-xl transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setStep("collect")}
                className="flex-1 bg-stellar-500 hover:bg-stellar-600 text-white font-medium py-3 rounded-xl transition-colors"
              >
                Collect Co-Signer Signatures →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: COLLECT ───────────────────────────────────────── */}
        {step === "collect" && (
          <div>
            <h3 id={stepHeadingId} className="font-display text-lg font-semibold text-white mb-4">
              Collect Co-Signer Signatures
            </h3>
            <p className="text-sm text-slate-300 mb-6">
              Paste each co-signer&apos;s signed XDR below. Once you have met the threshold of {threshold} signatures, you can submit the transaction.
            </p>

            <div className="mb-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-400">Signatures Collected:</span>
                <span className={clsx("font-mono font-semibold", thresholdMet ? "text-emerald-400" : "text-amber-400")}>
                  {signaturesCollected} of {threshold}
                </span>
              </div>
              <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                <div
                  className={clsx("h-full transition-all", thresholdMet ? "bg-emerald-500" : "bg-stellar-500")}
                  style={{ width: `${Math.min(100, (signaturesCollected / threshold) * 100)}%` }}
                />
              </div>

              {/* Signature Hints */}
              <div className="mt-4 space-y-2">
                <p className="text-xs text-slate-400">Signed hints:</p>
                <div className="flex flex-wrap gap-2">
                  {initiatorHints.map((hint, i) => (
                    <span key={`init-${i}`} className="bg-stellar-500/10 border border-stellar-500/20 text-stellar-300 text-xs font-mono px-2.5 py-1 rounded-lg">
                      Initiator: ...{hint}
                    </span>
                  ))}
                  {cosignerHints.map((hint, i) => (
                    <span key={`co-${i}`} className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-mono px-2.5 py-1 rounded-lg">
                      Co-Signer {i + 1}: ...{hint}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Paste Co-Signer Signed XDR
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pastedXDR}
                    onChange={(e) => setPastedXDR(e.target.value.trim())}
                    placeholder="AAAA..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white font-mono text-xs focus:outline-none focus:border-stellar-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddCosignerXDR}
                    className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm transition-colors whitespace-nowrap"
                  >
                    Add Signature
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep("share")}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-3 rounded-xl transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={!thresholdMet}
                onClick={() => setStep("submit")}
                className="flex-1 bg-stellar-500 hover:bg-stellar-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
              >
                Proceed to Submit →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 5: SUBMIT ────────────────────────────────────────── */}
        {step === "submit" && (
          <div>
            <h3 id={stepHeadingId} className="font-display text-lg font-semibold text-white mb-4">
              Submit Multi-Signature Transaction
            </h3>
            <p className="text-sm text-slate-300 mb-6">
              All required signatures have been collected. Submit the combined transaction to the Stellar network.
            </p>

            <div className="bg-white/5 p-4 rounded-xl mb-6 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Destination:</span>
                <span className="font-mono text-white truncate max-w-xs" title={destination}>{destination}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount:</span>
                <span className="font-mono text-white">{amount} XLM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Signatures Collected:</span>
                <span className="font-mono text-emerald-400">{signaturesCollected} of {threshold}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep("collect")}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-3 rounded-xl transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleSubmit}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
              >
                {loading ? "Submitting..." : "Submit to Stellar"}
              </button>
            </div>
          </div>
        )}

        {/* ── SUCCESS ───────────────────────────────────────────────── */}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
              ✓
            </div>
            <h3 id={stepHeadingId} className="font-display text-xl font-semibold text-white mb-2">
              Transaction Successful!
            </h3>
            <p className="text-sm text-slate-300 mb-6">
              The multi-signature payment has been successfully submitted to Stellar Horizon.
            </p>
            {txHash && (
              <div className="mb-6 p-3 bg-white/5 rounded-xl font-mono text-xs text-slate-300 break-all">
                Tx Hash: {txHash}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                clearMultiSigDraft(publicKey);
                setStep("build");
                setDestination("");
                setAmount("");
                setMemo("");
                setUnsignedXDR(null);
                setInitiatorSignedXDR(null);
                setCosignerXDRs([]);
                setTxHash(null);
              }}
              className="bg-stellar-500 hover:bg-stellar-600 text-white font-medium py-2.5 px-6 rounded-xl transition-colors"
            >
              Start New Payment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * components/SendPaymentForm.tsx
 * Form for sending XLM payments to any Stellar address.
 *
 * Issue #8 — Add a 'Send Max' button tooltip explaining the 1 XLM reserve
 * Emmy123222/Stellar-MicroPay
 */

import { useState } from "react";
import {
  buildPaymentTransaction,
  submitTransaction,
  isValidStellarAddress,
  explorerUrl,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatXLM } from "@/utils/format";
import clsx from "clsx";

interface SendPaymentFormProps {
  publicKey: string;
  xlmBalance: string;
  onSuccess?: () => void;
}

type Status = "idle" | "building" | "signing" | "submitting" | "success" | "error";

export default function SendPaymentForm({
  publicKey,
  xlmBalance,
  onSuccess,
}: SendPaymentFormProps) {
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const balance = parseFloat(xlmBalance);
  const amountNum = parseFloat(amount);
  const isValidDest = destination.length > 0 && isValidStellarAddress(destination);
  const MIN_STROOP = 0.0000001; // 1 stroop — Stellar's minimum transaction amount
  const isValidAmt =
    !isNaN(amountNum) && amountNum >= MIN_STROOP && amountNum <= balance - 1; // keep 1 XLM reserve
  const canSubmit =
    isValidDest && isValidAmt && status === "idle" && destination !== publicKey;

  const handleSend = async () => {
    if (!canSubmit) return;
    setError(null);
    setTxHash(null);

    try {
      // Step 1: Build transaction
      setStatus("building");
      const tx = await buildPaymentTransaction({
        fromPublicKey: publicKey,
        toPublicKey: destination,
        amount: amountNum.toFixed(7),
        memo: memo.trim() || undefined,
      });

      // Step 2: Sign with Freighter
      setStatus("signing");
      const { signedXDR, error: signError } = await signTransactionWithWallet(
        tx.toXDR()
      );
      if (signError || !signedXDR) {
        throw new Error(signError || "Signing failed");
      }

      // Step 3: Submit to Stellar network
      setStatus("submitting");
      const result = await submitTransaction(signedXDR);
      setTxHash(result.hash);
      setStatus("success");
      onSuccess?.();

      // Reset form after delay
      setTimeout(() => {
        setDestination("");
        setAmount("");
        setMemo("");
        setStatus("idle");
        setTxHash(null);
      }, 8000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const setMaxAmount = () => {
    const max = Math.max(0, balance - 1).toFixed(7);
    setAmount(max);
  };

  if (status === "success" && txHash) {
    return (
      <div className="card text-center animate-slide-up">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
          <CheckIcon className="w-7 h-7 text-emerald-400" />
        </div>
        <h3 className="font-display text-lg font-semibold text-white mb-1">
          {`Payment sent!`}
        </h3>
        <p className="text-slate-400 text-sm mb-4">
          {formatXLM(amount)} {`sent successfully`}
        </p>
        
        <a
          href={explorerUrl(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-stellar-400 hover:text-stellar-300 transition-colors"
        >
          {`View on Stellar Expert`}
          <ExternalLinkIcon className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  return (
    <div className="card animate-fade-in">
      <h2 className="font-display text-lg font-semibold text-white mb-6 flex items-center gap-2">
        <SendIcon className="w-5 h-5 text-stellar-400" />
        {`Send Payment`}
      </h2>

      <div className="space-y-5">
        {/* Destination */}
        <div>
          <label className="label">{`Recipient Address`}</label>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value.trim())}
            placeholder="G... (Stellar public key)"
            className={clsx(
              "input-field",
              destination.length > 0 && !isValidDest && "border-red-500/50"
            )}
            disabled={status !== "idle"}
          />
          {destination.length > 0 && !isValidDest && (
            <p className="mt-1 text-xs text-red-400">{`Invalid Stellar address`}</p>
          )}
          {destination === publicKey && (
            <p className="mt-1 text-xs text-amber-400">{`You cannot send to yourself`}</p>
          )}
        </div>

        {/* Amount */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">{`Amount (XLM)`}</label>

            {/* Issue #8 — info icon + pure CSS tooltip next to Max button */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={setMaxAmount}
                className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors"
                disabled={status !== "idle"}
              >
                {`Max: ${formatXLM(Math.max(0, balance - 1))}`}
              </button>

              <div className="relative group">
                <button
                  type="button"
                  aria-label="Stellar requires a 1 XLM minimum balance in your account"
                  className="w-4 h-4 flex items-center justify-center rounded-full border border-stellar-500/40 text-stellar-400 hover:border-stellar-500 hover:text-stellar-300 transition-colors focus:outline-none focus:ring-1 focus:ring-stellar-400"
                >
                  <InfoIcon className="w-2.5 h-2.5" />
                </button>

                {/* Tooltip — pure CSS, no library */}
                <div
                  role="tooltip"
                  className={clsx(
                    "pointer-events-none absolute bottom-full right-0 mb-2 w-56 z-50",
                    "rounded-lg border border-stellar-500/20 bg-cosmos-800 px-3 py-2 shadow-lg",
                    "text-xs text-slate-300 leading-relaxed",
                    "opacity-0 scale-95 transition-all duration-150",
                    "group-hover:opacity-100 group-hover:scale-100",
                    "group-focus-within:opacity-100 group-focus-within:scale-100"
                  )}
                >
                  {`Stellar requires a 1 XLM minimum balance in your account. The Max amount excludes this reserve.`}
                  <span className="absolute -bottom-1.5 right-3 w-3 h-3 rotate-45 border-r border-b border-stellar-500/20 bg-cosmos-800" />
                </div>
              </div>
            </div>
          </div>

          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0000000"
            min="0.0000001"
            step="0.0000001"
            className={clsx(
              "input-field",
              amount && !isValidAmt && "border-red-500/50"
            )}
            disabled={status !== "idle"}
          />
          {amount && !isValidAmt && (
            <p className="mt-1 text-xs text-red-400">
              {amountNum > balance - 1
                ? `Insufficient balance (1 XLM reserve required)`
                : `Minimum amount is 0.0000001 XLM (1 stroop)`}
            </p>
          )}
        </div>

        {/* Memo (optional) */}
        <div>
          <label className="label">{`Memo (optional)`}</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Payment note..."
            maxLength={28}
            className="input-field"
            disabled={status !== "idle"}
          />
          <p className="mt-1 text-xs text-slate-500">{`${memo.length}/28 characters`}</p>
        </div>

        {/* Error */}
        {status === "error" && error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSend}
          disabled={!canSubmit || status !== "idle"}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {status === "building" && <><Spinner /> {`Building transaction...`}</>}
          {status === "signing" && <><Spinner /> {`Sign in Freighter...`}</>}
          {status === "submitting" && <><Spinner /> {`Submitting...`}</>}
          {status === "idle" && (
            <>
              <SendIcon className="w-4 h-4" />
              {`Send ${amount ? formatXLM(amountNum) : "XLM"}`}
            </>
          )}
          {status === "error" && "Retry"}
        </button>

        {/* Status hint */}
        {status === "signing" && (
          <p className="text-center text-xs text-slate-400 animate-pulse">
            {`Please confirm the transaction in your Freighter wallet...`}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

// Issue #8 — Info icon for the 1 XLM reserve tooltip
function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v.01M12 13v4m0-8a9 9 0 110 18A9 9 0 0112 4z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
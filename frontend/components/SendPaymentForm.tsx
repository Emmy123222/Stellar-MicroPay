/**
 * components/SendPaymentForm.tsx
 * Form for sending XLM payments to any Stellar address.
 *
 * Issue #8 — Add a 'Send Max' button tooltip explaining the 1 XLM reserve
 * Emmy123222/Stellar-MicroPay
 */

import {
  buildPaymentTransaction,
  buildSorobanTipTransaction,
  CONTRACT_ID,
  explorerUrl,
  isValidStellarAddress,
  submitTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatXLM } from "@/utils/format";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

interface SendPaymentFormProps {
  publicKey: string;
  xlmBalance: string;
  usdcBalance?: string | null;
  onSuccess?: () => void;
  // FIX: Added prefill to interface to stop the "Property does not exist" error
  prefill?: {
    destination: string;
    amount: string;
    memo?: string;
    validUntil?: number;
  } | null;
}

type Status = "idle" | "building" | "signing" | "submitting" | "success" | "error";
type AssetType = "XLM" | "USDC";

const ESTIMATED_NETWORK_FEE = "0.00001 XLM";

interface BarcodeDetectorResult {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<BarcodeDetectorResult[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

export default function SendPaymentForm({
  publicKey,
  xlmBalance,
  usdcBalance,
  onSuccess,
  prefill,
}: SendPaymentFormProps) {
  const [selectedAsset, setSelectedAsset] = useState<AssetType>("XLM");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isTipOnChain, setIsTipOnChain] = useState(false);
  const [isScannerSupported, setIsScannerSupported] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const frameRequestRef = useRef<number | null>(null);
  const isDetectingRef = useRef(false);
  const lastInvalidScanRef = useRef<string | null>(null);

  // Sync state if prefill data is provided (e.g., from a payment link)
  useEffect(() => {
    if (prefill) {
      if (prefill.destination) setDestination(prefill.destination);
      if (prefill.amount) setAmount(prefill.amount);
      if (prefill.memo) setMemo(prefill.memo);
    }
  }, [prefill]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const detectorCtor = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor })
      .BarcodeDetector;
    const hasCameraApi = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    setIsScannerSupported(Boolean(detectorCtor && hasCameraApi));
  }, []);

  useEffect(() => {
    return () => {
      if (frameRequestRef.current !== null) {
        cancelAnimationFrame(frameRequestRef.current);
        frameRequestRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const xlmBal  = parseFloat(xlmBalance);
  const usdcBal = usdcBalance ? parseFloat(usdcBalance) : 0;
  // XLM has a 1 XLM reserve; USDC has no such constraint
  const balance  = selectedAsset === "XLM" ? xlmBal : usdcBal;
  const maxSend  = selectedAsset === "XLM" ? Math.max(0, xlmBal - 1) : usdcBal;

  const amountNum = parseFloat(amount);
  const isValidDest = destination.length > 0 && isValidStellarAddress(destination);
  const MIN_STROOP = 0.0000001;
  const isValidAmt =
    !isNaN(amountNum) && amountNum >= MIN_STROOP && amountNum <= maxSend;
  const canSubmit =
    isValidDest && isValidAmt && status === "idle" && destination !== publicKey;

  const executeSend = async () => {
    if (!canSubmit) return;
    setError(null);
    setTxHash(null);

    try {
      // Step 1: Build transaction
      setStatus("building");
      const tx = isTipOnChain
        ? await buildSorobanTipTransaction({
            fromPublicKey: publicKey,
            toPublicKey: destination,
            amount: amountNum.toFixed(7),
          })
        : await buildPaymentTransaction({
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

  const openConfirmation = () => {
    if (!canSubmit) return;
    setError(null);
    setIsConfirmOpen(true);
  };

  const closeConfirmation = () => {
    if (status !== "idle") return;
    setIsConfirmOpen(false);
  };

  const confirmAndSend = async () => {
    if (status !== "idle") return;
    setIsConfirmOpen(false);
    await executeSend();
  };

  const setMaxAmount = () => {
    setAmount(maxSend.toFixed(7));
  };

  const stopScanner = () => {
    if (frameRequestRef.current !== null) {
      cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const extractStellarAddress = (rawValue: string): string | null => {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;
    if (isValidStellarAddress(trimmed)) return trimmed;

    try {
      const url = new URL(trimmed);
      const fromParams =
        url.searchParams.get("destination") ||
        url.searchParams.get("addr") ||
        url.searchParams.get("account");
      if (fromParams && isValidStellarAddress(fromParams)) {
        return fromParams;
      }

      const fromPath = decodeURIComponent(url.pathname.replace(/\//g, ""));
      if (isValidStellarAddress(fromPath)) {
        return fromPath;
      }
    } catch {
      // Not a URL, continue with regex extraction.
    }

    const match = trimmed.match(/G[A-Z0-9]{55}/);
    if (match && isValidStellarAddress(match[0])) {
      return match[0];
    }

    return null;
  };

  const closeScanner = () => {
    stopScanner();
    setIsScannerOpen(false);
  };

  const openScanner = async () => {
    if (!isScannerSupported || status !== "idle") return;

    setScannerError(null);
    lastInvalidScanRef.current = null;
    setIsScannerOpen(true);

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });

      const detectorCtor = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor })
        .BarcodeDetector;
      if (!detectorCtor) {
        stopScanner();
        setIsScannerOpen(false);
        return;
      }

      streamRef.current = mediaStream;
      detectorRef.current = new detectorCtor({ formats: ["qr_code"] });

      const video = videoRef.current;
      if (!video) return;

      video.srcObject = mediaStream;
      await video.play();

      const detectFrame = async () => {
        if (!videoRef.current || !detectorRef.current) return;

        if (!isDetectingRef.current && videoRef.current.readyState >= 2) {
          isDetectingRef.current = true;

          try {
            const results = await detectorRef.current.detect(videoRef.current);
            if (results.length > 0) {
              const rawValue = results[0].rawValue?.trim() || "";
              if (rawValue) {
                const address = extractStellarAddress(rawValue);
                if (address) {
                  setDestination(address);
                  setScannerError(null);
                  closeScanner();
                  isDetectingRef.current = false;
                  return;
                }

                if (lastInvalidScanRef.current !== rawValue) {
                  setScannerError("Invalid QR code: no valid Stellar address found.");
                  lastInvalidScanRef.current = rawValue;
                }
              }
            }
          } catch {
            setScannerError("Unable to scan QR code from camera stream.");
          } finally {
            isDetectingRef.current = false;
          }
        }

        frameRequestRef.current = requestAnimationFrame(detectFrame);
      };

      frameRequestRef.current = requestAnimationFrame(detectFrame);
    } catch (err: unknown) {
      closeScanner();
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setScannerError("Camera permission denied. Please allow camera access to scan a QR code.");
        return;
      }

      setScannerError("Unable to access camera for QR scanning.");
    }
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
        {/* Asset selector */}
        <div className="flex gap-2">
          {(["XLM", "USDC"] as AssetType[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => { setSelectedAsset(a); setAmount(""); }}
              disabled={a === "USDC" && !usdcBalance}
              className={clsx(
                "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                selectedAsset === a
                  ? "bg-stellar-500/15 text-stellar-300 border-stellar-500/30"
                  : "text-slate-400 border-white/10 hover:border-white/20",
                a === "USDC" && !usdcBalance && "opacity-40 cursor-not-allowed"
              )}
            >
              {a}
              {a === "USDC" && !usdcBalance && (
                <span className="ml-1 text-xs">(no trustline)</span>
              )}
            </button>
          ))}
        </div>

        {/* Destination */}
        <div>
          <label className="label">{`Recipient Address`}</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value.trim())}
              placeholder="G... (Stellar public key)"
              className={clsx(
                "input-field",
                "flex-1",
                destination.length > 0 && !isValidDest && "border-red-500/50"
              )}
              disabled={status !== "idle"}
            />
            {isScannerSupported && (
              <button
                type="button"
                onClick={openScanner}
                disabled={status !== "idle"}
                className="h-11 w-11 shrink-0 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                aria-label="Scan Stellar address QR code"
                title="Scan Stellar address QR code"
              >
                <QrCodeIcon className="w-5 h-5" />
              </button>
            )}
          </div>
          {destination.length > 0 && !isValidDest && (
            <p className="mt-1 text-xs text-red-400">{`Invalid Stellar address`}</p>
          )}
          {destination === publicKey && (
            <p className="mt-1 text-xs text-amber-400">{`You cannot send to yourself`}</p>
          )}
          {scannerError && (
            <p className="mt-1 text-xs text-red-400">{scannerError}</p>
          )}
        </div>

        {/* Amount */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">{`Amount (${selectedAsset})`}</label>

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
              {amountNum > maxSend
                ? selectedAsset === "XLM"
                  ? `Insufficient balance (1 XLM reserve required)`
                  : `Insufficient USDC balance`
                : `Minimum amount is 0.0000001 ${selectedAsset} (1 stroop)`}
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

        {/* Record as Tip On-Chain (Soroban) */}
        {CONTRACT_ID && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-stellar-500/5 border border-stellar-500/10 transition-colors hover:bg-stellar-500/8">
            <div className="flex items-center h-5">
              <input
                id="tip-on-chain"
                type="checkbox"
                checked={isTipOnChain}
                onChange={(e) => setIsTipOnChain(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-stellar-500 focus:ring-stellar-500/20"
                disabled={status !== "idle"}
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="tip-on-chain" className="text-sm font-medium text-slate-200 cursor-pointer">
                {`Record as tip on-chain`}
              </label>
              <p className="text-xs text-slate-500 mt-0.5">
                {`This payment will be permanently recorded as a tip on the Soroban smart contract.`}
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={openConfirmation}
          disabled={!canSubmit || status !== "idle"}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {status === "building" && <><Spinner /> {`Building transaction...`}</>}
          {status === "signing" && <><Spinner /> {`Sign in Freighter...`}</>}
          {status === "submitting" && <><Spinner /> {`Submitting...`}</>}
          {status === "idle" && (
            <>
              <SendIcon className="w-4 h-4" />
              {`Send ${amount ? formatXLM(amountNum) : ""} ${selectedAsset}`.trim()}
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

      <SendConfirmationModal
        isOpen={isConfirmOpen}
        destination={destination}
        amount={amountNum}
        memo={memo}
        estimatedFee={ESTIMATED_NETWORK_FEE}
        isTipOnChain={isTipOnChain}
        onCancel={closeConfirmation}
        onConfirm={confirmAndSend}
      />

      {isScannerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 p-4 flex items-center justify-center">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Scan destination QR</h3>
              <button
                type="button"
                onClick={closeScanner}
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-xl border border-slate-700 bg-slate-950 aspect-square object-cover"
            />
            <p className="mt-2 text-xs text-slate-400">
              Point your camera at a Stellar address QR code.
            </p>
            {scannerError && (
              <p className="mt-2 text-xs text-red-400">{scannerError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SendConfirmationModalProps {
  isOpen: boolean;
  destination: string;
  amount: number;
  memo: string;
  estimatedFee: string;
  isTipOnChain: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function SendConfirmationModal({
  isOpen,
  destination,
  amount,
  memo,
  estimatedFee,
  isTipOnChain,
  onCancel,
  onConfirm,
}: SendConfirmationModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-confirmation-title"
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <h3 id="send-confirmation-title" className="font-display text-lg font-semibold text-white">
          Confirm payment
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          Review details before opening Freighter.
        </p>

        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="text-slate-400">Destination</dt>
            <dd className="mt-1 break-all rounded-lg border border-slate-700/80 bg-slate-950/50 px-3 py-2 text-slate-100">
              {destination}
            </dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-slate-400">Amount</dt>
              <dd className="mt-1 text-slate-100">{formatXLM(amount)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Estimated fee</dt>
              <dd className="mt-1 text-slate-100">{estimatedFee}</dd>
            </div>
          </div>
          {memo.trim() && (
            <div>
              <dt className="text-slate-400">Memo</dt>
              <dd className="mt-1 text-slate-100">{memo.trim()}</dd>
            </div>
          )}
          {isTipOnChain && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stellar-500/10 border border-stellar-500/20 text-stellar-400">
              <CheckIcon className="w-4 h-4" />
              <span className="text-xs font-medium">Recorded on-chain via Soroban</span>
            </div>
          )}
        </dl>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-primary px-4 py-2 text-sm"
            autoFocus
          >
            Confirm
          </button>
        </div>
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

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v.01M12 13v4m0-8a9 9 0 110 18A9 9 0 0112 4z" />
    </svg>
  );
}

function QrCodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h2m4 0h-2m-4 4h2m4 0h-2m-2-2v4m-6-6h2m2-2v2m0 4h2" />
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

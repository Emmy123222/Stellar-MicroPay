/**
 * components/SendPaymentForm.tsx
 * Form for sending XLM payments to any Stellar address.
 *
 * Issue #8 - Add a 'Send Max' button tooltip explaining the 1 XLM reserve
 * Emmy123222/Stellar-MicroPay
 */

import PaymentStatusModal, {
  type PaymentFlowStatus,
  type PaymentStepId,
  type PaymentStepTiming,
} from "@/components/PaymentStatusModal";
import {
  buildPaymentTransaction,
  buildSorobanTipTransaction,
  explorerUrl,
  fetchNetworkFeeStats,
  isValidStellarAddress,
  server,
  submitTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatXLM, shortenAddress } from "@/utils/format";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

interface SendPaymentFormProps {
  publicKey: string;
  xlmBalance: string;
  usdcBalance?: string | null;
  onSuccess?: (txHash?: string) => void;
  title?: string;
  submitLabel?: string;
  successTitle?: string;
  successMessage?: string;
  assetOptions?: AssetType[];
  hideAssetSelector?: boolean;
  hideDestinationField?: boolean;
  destinationReadOnly?: boolean;
  hideAmountField?: boolean;
  hideMemoField?: boolean;
  prefill?: {
    destination: string;
    amount: string;
    memo?: string;
    validUntil?: number;
    fromHistory?: boolean;
  } | null;
  aiPrefill?: {
    destination: string;
    amount: string;
    memo?: string;
  } | null;
}

type Status = PaymentFlowStatus;
type AssetType = "XLM" | "USDC" | "CUSTOM";

interface CustomAsset {
  code: string;
  issuer: string;
}

type FavouriteEntry = {
  name: string;
  address: string;
};

const ESTIMATED_NETWORK_FEE = "0.00001 XLM";
const FAVOURITES_STORAGE_KEY = "stellar-micropay:favourites";

interface BarcodeDetectorResult {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<BarcodeDetectorResult[]>;
}

const RECENT_RECIPIENTS_KEY = "stellar-micropay:recent-recipients";
const MAX_RECENT = 3;

function createInitialStepTimings(): Record<PaymentStepId, PaymentStepTiming> {
  return {
    building: { startedAt: null, completedAt: null, error: null },
    signing: { startedAt: null, completedAt: null, error: null },
    submitting: { startedAt: null, completedAt: null, error: null },
    confirming: { startedAt: null, completedAt: null, error: null },
  };
}

export default function SendPaymentForm({
  publicKey,
  xlmBalance,
  usdcBalance,
  onSuccess,
  prefill,
  title = "Send Payment",
  submitLabel,
  successTitle = "Payment sent!",
  successMessage,
  assetOptions = ["XLM", "USDC"],
  hideAssetSelector = false,
  hideDestinationField = false,
  destinationReadOnly = false,
  hideAmountField = false,
  hideMemoField = false,
}: SendPaymentFormProps) {
  const [selectedAsset, setSelectedAsset] = useState<AssetType>("XLM");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [isResolvingUsername, setIsResolvingUsername] = useState(false);
  const [usernameResolutionError, setUsernameResolutionError] = useState<string | null>(null);
  const [customAsset, setCustomAsset] = useState<CustomAsset>({ code: "", issuer: "" });
  const [showCustomAssetForm, setShowCustomAssetForm] = useState(false);
  const [selectedMemoTemplate, setSelectedMemoTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isTipOnChain, setIsTipOnChain] = useState(false);
  const [failedStep, setFailedStep] = useState<PaymentStepId | null>(null);
  const [stepTimings, setStepTimings] = useState<Record<PaymentStepId, PaymentStepTiming>>(
    createInitialStepTimings()
  );
  const [isScannerSupported, setIsScannerSupported] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [networkFeeXlm, setNetworkFeeXlm] = useState(0.00001);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!txHash) return;
    try {
      await navigator.clipboard.writeText(txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const frameRequestRef = useRef<number | null>(null);
  const isDetectingRef = useRef(false);

  useEffect(() => {
    const checkSupport = async () => {
      if (typeof window !== "undefined" && "BarcodeDetector" in window) {
        setIsScannerSupported(true);
      }
    };
    checkSupport();
  }, []);

  const openScanner = async () => {
    setIsScannerOpen(true);
    setScannerError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      startDetection();
    } catch (err) {
      setScannerError("Camera access denied or not available.");
      setIsScannerOpen(false);
    }
  };

  const closeScanner = () => {
    setIsScannerOpen(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (frameRequestRef.current) {
      cancelAnimationFrame(frameRequestRef.current);
    }
    isDetectingRef.current = false;
  };

  const startDetection = () => {
    if (typeof window === "undefined" || !("BarcodeDetector" in window)) return;

    const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
    detectorRef.current = detector;
    isDetectingRef.current = true;

    const detect = async () => {
      if (!isDetectingRef.current || !videoRef.current) return;

      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          const result = barcodes[0].rawValue;
          if (isValidStellarAddress(result)) {
            setDestination(result);
            closeScanner();
            return;
          }
        }
      } catch (e) {
        // detection error
      }

      frameRequestRef.current = requestAnimationFrame(detect);
    };

    detect();
  };

  const [recentRecipients, setRecentRecipients] = useState<string[]>(() => {
    try {
      if (typeof window !== "undefined") {
        return JSON.parse(sessionStorage.getItem(RECENT_RECIPIENTS_KEY) ?? "[]");
      }
      return [];
    } catch {
      return [];
    }
  });

  const [favourites, setFavourites] = useState<FavouriteEntry[]>(() => {
    try {
      if (typeof window !== "undefined") {
        return JSON.parse(localStorage.getItem(FAVOURITES_STORAGE_KEY) ?? "[]");
      }
      return [];
    } catch {
      return [];
    }
  });

  const [isFavouritesDropdownOpen, setIsFavouritesDropdownOpen] = useState(false);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const saveFavourites = (items: FavouriteEntry[]) => {
    setFavourites(items);
    if (typeof window !== "undefined") {
      localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(items));
    }
  };

  const renameFavourite = (address: string, newName: string) => {
    saveFavourites(favourites.map((f) => (f.address === address ? { ...f, name: newName } : f)));
  };

  const deleteFavourite = (address: string) => {
    saveFavourites(favourites.filter((f) => f.address !== address));
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsFavouritesDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const saveRecipient = (address: string) => {
    const updated = [address, ...recentRecipients.filter((a) => a !== address)].slice(0, MAX_RECENT);
    setRecentRecipients(updated);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(RECENT_RECIPIENTS_KEY, JSON.stringify(updated));
    }
  };

  const clearRecipients = () => {
    setRecentRecipients([]);
    sessionStorage.removeItem(RECENT_RECIPIENTS_KEY);
  };

  const memoTemplates = ["Rent", "Salary", "Invoice", "Gift", "Coffee ☕"];

  const handleMemoTemplateClick = (template: string) => {
    if (selectedMemoTemplate === template) {
      setSelectedMemoTemplate(null);
      setMemo("");
      return;
    }
    setSelectedMemoTemplate(template);
    setMemo(template);
  };

  const handleMemoChange = (value: string) => {
    setMemo(value);
    if (value !== selectedMemoTemplate) {
      setSelectedMemoTemplate(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadFee = async () => {
      try {
        const feeStats = await fetchNetworkFeeStats();
        if (!cancelled) {
          setNetworkFeeXlm(feeStats.baseFeeXlm || 0.00001);
        }
      } catch {
        if (!cancelled) {
          setNetworkFeeXlm(0.00001);
        }
      }
    };
    loadFee();
    const intervalId = window.setInterval(loadFee, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!prefill) return;
    if (prefill.destination) setDestination(prefill.destination);
    if (prefill.amount) setAmount(prefill.amount);
    if (prefill.memo) setMemo(prefill.memo);
  }, [prefill]);

  const xlmBal = parseFloat(xlmBalance);
  const usdcBal = usdcBalance ? parseFloat(usdcBalance) : 0;
  const balance = selectedAsset === "XLM" ? xlmBal : usdcBal;
  const maxSend = selectedAsset === "XLM" ? Math.max(0, xlmBal - 1) : usdcBal;

  const amountNum = parseFloat(amount);
  const hasAmount = Number.isFinite(amountNum) && amountNum > 0;
  const estimatedTotalDeducted = hasAmount ? amountNum + networkFeeXlm : null;
  const isValidDest = destination.length > 0 && isValidStellarAddress(destination);
  
  const isUsernameDestination = /^@?[a-zA-Z0-9]{3,20}$/.test(destination) && !isValidStellarAddress(destination);
  
  const MIN_STROOP = 0.0000001;
  const isValidAmt = !Number.isNaN(amountNum) && amountNum >= MIN_STROOP && amountNum <= maxSend;
  
  const canSubmit = (isValidDest || (isUsernameDestination && !isResolvingUsername && !usernameResolutionError)) && 
    isValidAmt && status === "idle" && destination !== publicKey;

  const resolveUsername = async (username: string) => {
    const cleanUsername = username.replace(/^@/, "").toLowerCase();
    if (!/^[a-zA-Z0-9]{3,20}$/.test(cleanUsername)) {
      setUsernameResolutionError("Invalid username format");
      return;
    }
    setIsResolvingUsername(true);
    setUsernameResolutionError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      const response = await fetch(`${apiBase}/api/accounts/resolve/${encodeURIComponent(cleanUsername)}`);
      if (!response.ok) throw new Error("Username not found");
      const payload = await response.json();
      if (payload?.success && payload?.data?.publicKey) {
        setDestination(payload.data.publicKey);
        setUsernameResolutionError(null);
      } else {
        throw new Error("Failed to resolve username");
      }
    } catch (err) {
      setUsernameResolutionError(err instanceof Error ? err.message : "Failed to resolve username");
    } finally {
      setIsResolvingUsername(false);
    }
  };

  const handleSelectFavourite = (address: string) => {
    setDestination(address);
    setIsFavouritesDropdownOpen(false);
  };

  const startTracker = () => {
    setIsStatusModalOpen(true);
    setError(null);
    setTxHash(null);
    setFailedStep(null);
    setStepTimings(createInitialStepTimings());
  };

  const markStepStarted = (step: PaymentStepId) => {
    const now = Date.now();
    setStepTimings((prev) => ({
      ...prev,
      [step]: { ...prev[step], startedAt: now },
    }));
  };

  const markStepCompleted = (step: PaymentStepId) => {
    const now = Date.now();
    setStepTimings((prev) => ({
      ...prev,
      [step]: { ...prev[step], completedAt: now },
    }));
  };

  const markStepFailed = (step: PaymentStepId, message: string) => {
    const now = Date.now();
    setFailedStep(step);
    setStepTimings((prev) => ({
      ...prev,
      [step]: { ...prev[step], error: message },
    }));
  };

  const closeStatusModal = () => {
    setIsStatusModalOpen(false);
    if (status === "success") {
      setDestination("");
      setAmount("");
      setMemo("");
    }
    setStatus("idle");
  };

  const executeSend = async () => {
    if (!canSubmit) return;
    startTracker();
    let activeStep: PaymentStepId = "building";
    try {
      markStepStarted("building");
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
      markStepCompleted("building");

      activeStep = "signing";
      markStepStarted("signing");
      setStatus("signing");
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) throw new Error(signError || "Signing failed");
      markStepCompleted("signing");

      activeStep = "submitting";
      markStepStarted("submitting");
      setStatus("submitting");
      const result = await submitTransaction(signedXDR);
      setTxHash(result.hash);
      markStepCompleted("submitting");

      activeStep = "confirming";
      markStepStarted("confirming");
      setStatus("confirming");
      await waitForTransactionConfirmation(result.hash);
      markStepCompleted("confirming");

      setStatus("success");
      saveRecipient(destination);
      onSuccess?.(result.hash);
    } catch (err: any) {
      const message = err?.message || "An unexpected error occurred";
      setError(message);
      markStepFailed(activeStep, message);
      setStatus("error");
    }
  };

  const waitForTransactionConfirmation = async (hash: string) => {
    let confirmed = false;
    let attempts = 0;
    while (!confirmed && attempts < 10) {
      try {
        await server.transactions().transaction(hash).call();
        confirmed = true;
      } catch (e) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (!confirmed) throw new Error("Transaction confirmation timed out.");
  };

  const setMaxAmount = () => setAmount(maxSend.toFixed(7));

  const openConfirmation = () => {
    if (!canSubmit) return;
    setIsConfirmOpen(true);
  };

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!txHash) return;
    navigator.clipboard.writeText(txHash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (status === "success" && txHash) {
    const truncatedHash = `${txHash.slice(0, 12)}…${txHash.slice(-6)}`;
    return (
      <div className="card text-center animate-slide-up relative overflow-hidden">
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
             <div key={i} className="confetti-piece" style={{ left: `${i * 10}%`, animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stellar-500/20 text-stellar-400">
          <CheckIcon className="h-8 w-8" />
        </div>
        <h2 className="mb-2 font-display text-2xl font-bold text-white">{successTitle}</h2>
        <p className="mb-6 text-slate-400">{successMessage || "Your payment has been confirmed on the Stellar network."}</p>
        
        <div className="mb-8 rounded-xl border border-white/5 bg-white/5 p-4">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Transaction Hash</p>
          <div className="flex items-center justify-center gap-2">
            <code className="text-xs text-stellar-300">{truncatedHash}</code>
            <button onClick={handleCopy} className="text-slate-500 hover:text-white transition-colors">
              {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-400" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <a href={explorerUrl(txHash)} target="_blank" rel="noopener noreferrer" className="btn-primary flex items-center justify-center gap-2">
            View on Explorer <ExternalLinkIcon className="h-4 w-4" />
          </a>
          <button onClick={() => setStatus("idle")} className="text-sm text-slate-400 hover:text-white transition-colors">
            Send another payment
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card animate-fade-in">
      <h2 className="font-display text-lg font-semibold text-white mb-6 flex items-center gap-2">
        <SendIcon className="w-5 h-5 text-stellar-400" />
        {title}
      </h2>

      <div className="space-y-5">
        {!hideAssetSelector && (
          <div className="flex gap-2">
            {assetOptions.map((a) => (
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
              </button>
            ))}
          </div>
        )}

        {!hideDestinationField && (
          <div className="relative" ref={dropdownRef}>
            <div className="mb-2 flex items-center justify-between">
              <label className="label mb-0">Destination</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFavouritesDropdownOpen(!isFavouritesDropdownOpen)}
                  className="text-xs text-stellar-400 hover:text-stellar-300"
                >
                  {isFavouritesDropdownOpen ? "Close" : "Favourites"}
                </button>
                {isValidDest && (
                  <button
                    type="button"
                    onClick={() => {
                      const existing = favourites.find((f) => f.address === destination);
                      if (existing) deleteFavourite(destination);
                      else {
                        const name = prompt("Name this favourite:", destination.slice(0, 8));
                        if (name) saveFavourites([...favourites, { name, address: destination }]);
                      }
                    }}
                    className="text-stellar-400 hover:text-stellar-300"
                    title={favourites.some((f) => f.address === destination) ? "Remove favourite" : "Add favourite"}
                  >
                    <StarIcon className="h-5 w-5" filled={favourites.some((f) => f.address === destination)} />
                  </button>
                )}
                {isScannerSupported && status === "idle" && (
                  <button type="button" onClick={openScanner} className="text-slate-400 hover:text-white" title="Scan QR Code">
                    <QrCodeIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
            
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="G... or @username"
              className={clsx("input-field font-mono text-sm", destination && !isValidDest && !isUsernameDestination && "border-red-500/50")}
              disabled={status !== "idle" || destinationReadOnly}
            />

            {isFavouritesDropdownOpen && favourites.length > 0 && (
              <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-1 shadow-2xl">
                {favourites.map((item) => (
                  <button
                    key={item.address}
                    type="button"
                    onClick={() => handleSelectFavourite(item.address)}
                    className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-white/5"
                  >
                    <span className="text-sm font-medium text-slate-200">{item.name}</span>
                    <span className="text-xs text-slate-500">{shortenAddress(item.address, 8)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!hideAmountField && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="label mb-0">Amount ({selectedAsset})</label>
              <button type="button" onClick={setMaxAmount} className="text-xs text-stellar-400 hover:text-stellar-300" disabled={status !== "idle"}>
                Max: {formatXLM(maxSend)}
              </button>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0000000"
              className={clsx("input-field", amount && !isValidAmt && "border-red-500/50")}
              disabled={status !== "idle"}
            />
          </div>
        )}

        {!hideMemoField && (
          <div>
            <label className="label">Memo (optional)</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => handleMemoChange(e.target.value.slice(0, 28))}
              placeholder="Payment note..."
              className="input-field"
              disabled={status !== "idle"}
            />
          </div>
        )}

        <button
          onClick={openConfirmation}
          disabled={!canSubmit || status !== "idle"}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {status === "idle" ? `Send ${amount || ""} ${selectedAsset}` : "Processing..."}
        </button>
      </div>

      <SendConfirmationModal
        isOpen={isConfirmOpen}
        destination={destination}
        amount={amountNum}
        memo={memo}
        estimatedFee={ESTIMATED_NETWORK_FEE}
        isTipOnChain={isTipOnChain}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => { setIsConfirmOpen(false); executeSend(); }}
      />

      <PaymentStatusModal
        isOpen={isStatusModalOpen}
        status={status}
        txHash={txHash}
        error={error}
        failedStep={failedStep}
        stepTimings={stepTimings}
        onClose={closeStatusModal}
      />
    </div>
  );
}

// Icons
function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} fill={filled ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  );
}

function QrCodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
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

function SendConfirmationModal({ isOpen, destination, amount, memo, estimatedFee, onCancel, onConfirm }: SendConfirmationModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 border border-white/10 shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-4">Confirm Payment</h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-500 uppercase font-bold">To</p>
            <p className="text-sm font-mono text-slate-200 break-all">{destination}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold">Amount</p>
              <p className="text-lg font-bold text-white">{amount} XLM</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold">Fee</p>
              <p className="text-sm text-slate-300">{estimatedFee}</p>
            </div>
          </div>
          {memo && (
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold">Memo</p>
              <p className="text-sm text-slate-200">{memo}</p>
            </div>
          )}
        </div>
        <div className="mt-8 flex gap-3">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-white/10 py-3 text-sm font-semibold text-white hover:bg-white/5 transition-all">Cancel</button>
          <button onClick={onConfirm} className="flex-1 btn-primary py-3">Confirm & Send</button>
        </div>
      </div>
    </div>
  );
}

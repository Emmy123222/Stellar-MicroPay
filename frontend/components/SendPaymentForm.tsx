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
  onSuccess?: () => void;
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
  // FIX: Added prefill to interface to stop the "Property does not exist" error
  prefill?: {
    destination: string;
    amount: string;
    memo?: string;
    validUntil?: number;
  } | null;
  // AI Assistant prefill
  aiPrefill?: {
    destination: string;
    amount: string;
    memo?: string;
  } | null;
}

type Status = PaymentFlowStatus;
type AssetType = "XLM" | "USDC";

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

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
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
  const [selectedMemoTemplate, setSelectedMemoTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isTipOnChain, setIsTipOnChain] = useState(false);
  const [failedStep, setFailedStep] = useState<PaymentStepId | null>(null);
  const [stepTimings, setStepTimings] = useState<Record<PaymentStepId, PaymentStepTiming>>(
    createInitialStepTimings
  );
  const [isScannerSupported, setIsScannerSupported] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const frameRequestRef = useRef<number | null>(null);
  const isDetectingRef = useRef(false);
  const lastInvalidScanRef = useRef<string | null>(null);

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
    if (!("BarcodeDetector" in window)) return;

    // @ts-ignore
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

  const toggleFavourite = () => {
    if (!isValidDest) return;
    const existing = favourites.find((f) => f.address === destination);
    if (existing) {
      saveFavourites(favourites.filter((f) => f.address !== destination));
    } else {
      const name = prompt("Enter a name for this favourite:", destination.slice(0, 8));
      if (name) {
        saveFavourites([...favourites, { name, address: destination }]);
      }
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
    if (!prefill) return;

    if (prefill.destination) setDestination(prefill.destination);
    if (prefill.amount) setAmount(prefill.amount);
    if (prefill.memo) setMemo(prefill.memo);
  }, [prefill]);

  const xlmBal = parseFloat(xlmBalance);
  const usdcBal = usdcBalance ? parseFloat(usdcBalance) : 0;
  // XLM has a 1 XLM reserve; USDC has no such constraint
  const balance = selectedAsset === "XLM" ? xlmBal : usdcBal;
  const maxSend = selectedAsset === "XLM" ? Math.max(0, xlmBal - 1) : usdcBal;

  const amountNum = parseFloat(amount);
  const isValidDest = destination.length > 0 && isValidStellarAddress(destination);
  const MIN_STROOP = 0.0000001;
  const isValidAmt =
    !Number.isNaN(amountNum) && amountNum >= MIN_STROOP && amountNum <= maxSend;
  const canSubmit =
    isValidDest && isValidAmt && status === "idle" && destination !== publicKey;

  const resetTracker = () => {
    setStatus("idle");
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
      [step]: {
        startedAt: prev[step].startedAt ?? now,
        completedAt: null,
        error: null,
      },
    }));
  };

  const markStepCompleted = (step: PaymentStepId) => {
    const now = Date.now();
    setStepTimings((prev) => ({
      ...prev,
      [step]: {
        startedAt: prev[step].startedAt ?? now,
        completedAt: now,
        error: null,
      },
    }));
  };

  const markStepFailed = (step: PaymentStepId, message: string) => {
    const now = Date.now();
    setFailedStep(step);
    setStepTimings((prev) => ({
      ...prev,
      [step]: {
        startedAt: prev[step].startedAt ?? now,
        completedAt: null,
        error: message,
      },
    }));
  };

  const closeStatusModal = () => {
    setIsStatusModalOpen(false);

    if (status === "success") {
      setDestination("");
      setAmount("");
      setMemo("");
    }

    resetTracker();
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
      const { signedXDR, error: signError } = await signTransactionWithWallet(
        tx.toXDR()
      );
      if (signError || !signedXDR) {
        throw new Error(signError || "Signing failed");
      }
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
      onSuccess?.();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      markStepFailed(activeStep, message);
      setStatus("error");
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
    if (!confirmed) {
      throw new Error("Transaction confirmation timed out. It may still succeed.");
    }
  };

  return (
    <>
      <div className="card animate-fade-in">
        <h2 className="mb-6 flex items-center gap-2 font-display text-lg font-semibold text-white">
          <SendIcon className="h-5 w-5 text-stellar-400" />
          {title}
        </h2>

        <div className="space-y-5">
          {/* Asset selector */}
          {!hideAssetSelector && (
            <div className="flex gap-2">
              {assetOptions.map((asset) => (
                <button
                  key={asset}
                  type="button"
                  onClick={() => {
                    setSelectedAsset(asset);
                    setAmount("");
                  }}
                  disabled={asset === "USDC" && !usdcBalance}
                  className={clsx(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition-all",
                    selectedAsset === asset
                      ? "border-stellar-500/30 bg-stellar-500/15 text-stellar-300"
                      : "border-white/10 text-slate-400 hover:border-white/20",
                    asset === "USDC" && !usdcBalance && "cursor-not-allowed opacity-40"
                  )}
                >
                  {asset}
                  {asset === "USDC" && !usdcBalance && (
                    <span className="ml-1 text-xs">(no trustline)</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Pre-fill notice */}
          {prefill && (
            <div className="flex items-center gap-2 rounded-lg border border-stellar-500/20 bg-stellar-500/10 px-3 py-2 text-xs text-stellar-400">
              <InfoIcon className="h-3.5 w-3.5 flex-shrink-0" />
              Pre-filled from transaction history
            </div>
          )}

          {/* Destination */}
          {!hideDestinationField && (
            <div className="relative" ref={dropdownRef}>
              <label className="label">{`Recipient Address`}</label>
              <div className="relative">
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value.trim())}
                  onFocus={() => setIsFavouritesDropdownOpen(true)}
                  placeholder="G... (Stellar public key)"
                  className={clsx(
                    "input-field pr-20",
                    destination.length > 0 && !isValidDest && "border-red-500/50"
                  )}
                  disabled={destinationReadOnly || status !== "idle"}
                  readOnly={destinationReadOnly}
                />
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  {isValidDest && (
                    <button
                      type="button"
                      onClick={toggleFavourite}
                      className={clsx(
                        "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                        favourites.some((f) => f.address === destination)
                          ? "text-amber-400 hover:bg-amber-400/10"
                          : "text-slate-400 hover:bg-white/10"
                      )}
                      title={
                        favourites.some((f) => f.address === destination)
                          ? "Remove from favourites"
                          : "Add to favourites"
                      }
                    >
                      <StarIcon
                        className="h-5 w-5"
                        filled={favourites.some((f) => f.address === destination)}
                      />
                    </button>
                  )}
                  {isScannerSupported && status === "idle" && (
                    <button
                      type="button"
                      onClick={openScanner}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                      title="Scan QR Code"
                    >
                      <QrCodeIcon className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Favourites Dropdown */}
              {isFavouritesDropdownOpen && favourites.length > 0 && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Favourite Recipients
                  </div>
                  {favourites.map((item) => (
                    <button
                      key={item.address}
                      type="button"
                      onClick={() => handleSelectFavourite(item.address)}
                      className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/5"
                    >
                      <span className="text-sm font-medium text-slate-200">{item.name}</span>
                      <span className="text-xs text-slate-500">{shortenAddress(item.address, 8)}</span>
                    </button>
                  ))}
                  <div className="mt-1 border-t border-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsFavouritesDropdownOpen(false);
                        setIsManageModalOpen(true);
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium text-stellar-400 transition-colors hover:bg-stellar-400/10"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                      Manage Favourites
                    </button>
                  </div>
                </div>
              )}

              {destination.length > 0 && !isValidDest && (
                <p className="mt-1 text-xs text-red-400">{`Invalid Stellar address`}</p>
              )}
              {destination === publicKey && (
                <p className="mt-1 text-xs text-amber-400">{`You cannot send to yourself`}</p>
              )}
            </div>
          )}

          {/* Recent recipients */}
          {recentRecipients.length > 0 && !isFavouritesDropdownOpen && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="label mb-0">Recent recipients</span>
                <button
                  type="button"
                  onClick={clearRecipients}
                  className="text-xs text-slate-500 transition-colors hover:text-red-400"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentRecipients.map((addr) => (
                  <button
                    key={addr}
                    type="button"
                    onClick={() => setDestination(addr)}
                    className="rounded-full border border-stellar-500/20 bg-stellar-500/5 px-3 py-1.5 text-xs font-mono text-stellar-300 transition-all hover:border-stellar-500/50 hover:bg-stellar-500/10"
                  >
                    {shortenAddress(addr)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Amount */}
          {!hideAmountField && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="label mb-0">{`Amount (${selectedAsset})`}</label>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={setMaxAmount}
                    className="text-xs text-stellar-400 transition-colors hover:text-stellar-300"
                    disabled={status !== "idle"}
                  >
                    {`Max: ${formatXLM(maxSend)}`}
                  </button>

                  <div className="group relative">
                    <button
                      type="button"
                      aria-label="Stellar requires a 1 XLM minimum balance in your account"
                      className="flex h-4 w-4 items-center justify-center rounded-full border border-stellar-500/40 text-stellar-400 transition-colors hover:border-stellar-500 hover:text-stellar-300 focus:outline-none focus:ring-1 focus:ring-stellar-400"
                    >
                      <InfoIcon className="h-2.5 w-2.5" />
                    </button>

                    <div
                      role="tooltip"
                      className={clsx(
                        "pointer-events-none absolute bottom-full right-0 z-50 mb-2 w-56",
                        "rounded-lg border border-stellar-500/20 bg-slate-900 px-3 py-2 shadow-lg",
                        "text-xs leading-relaxed text-slate-300",
                        "scale-95 opacity-0 transition-all duration-150",
                        "group-hover:scale-100 group-hover:opacity-100",
                        "group-focus-within:scale-100 group-focus-within:opacity-100"
                      )}
                    >
                      {`Stellar requires a 1 XLM minimum balance in your account. The Max amount excludes this reserve.`}
                      <span className="absolute -bottom-1.5 right-3 h-3 w-3 rotate-45 border-b border-r border-stellar-500/20 bg-slate-900" />
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
          )}

          {/* Memo (optional) */}
          {!hideMemoField && (
            <div>
              <label className="label">{`Memo (optional)`}</label>
              <input
                type="text"
                value={memo}
                onChange={(e) => handleMemoChange(e.target.value)}
                placeholder="Payment note..."
                maxLength={28}
                className="input-field"
                disabled={status !== "idle"}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                {memoTemplates.map((template) => {
                  const isActive = selectedMemoTemplate === template;
                  return (
                    <button
                      key={template}
                      type="button"
                      onClick={() => handleMemoTemplateClick(template)}
                      disabled={status !== "idle"}
                      className={clsx(
                        "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-stellar-500/20 border-stellar-500/30 text-stellar-300"
                          : "bg-stellar-500/10 border-stellar-500/15 text-slate-300 hover:bg-stellar-500/15",
                        status !== "idle" && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {template}
                    </button>
                  );
                })}
              </div>

              <p className="mt-3 text-xs text-slate-500">{`${memo.length}/28 characters`}</p>
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={openConfirmation}
            disabled={!canSubmit || status !== "idle"}
            className="btn-primary flex w-full items-center justify-center gap-2"
          >
            {status === "building" && <><Spinner /> {`Building transaction...`}</>}
            {status === "signing" && <><Spinner /> {`Sign in Freighter...`}</>}
            {status === "submitting" && <><Spinner /> {`Submitting to Stellar...`}</>}
            {status === "confirming" && <><Spinner /> {`Confirming on network...`}</>}
            {status === "idle" && (
              <>
                <SendIcon className="h-4 w-4" />
                {submitLabel || `Send ${amount ? formatXLM(amountNum) : ""} ${selectedAsset}`.trim()}
              </>
            )}
            {status === "success" && "Payment complete"}
            {status === "error" && "Review payment status"}
          </button>

          {status === "signing" && (
            <p className="animate-pulse text-center text-xs text-slate-400">
              {`Please confirm the transaction in your Freighter wallet...`}
            </p>
          )}
        </div>
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

      <PaymentStatusModal
        isOpen={isStatusModalOpen}
        status={status}
        txHash={txHash}
        error={error}
        failedStep={failedStep}
        stepTimings={stepTimings}
        explorerHref={txHash ? explorerUrl(txHash) : null}
        onClose={closeStatusModal}
      />

      <FavouritesModal
        isOpen={isManageModalOpen}
        favourites={favourites}
        onClose={() => setIsManageModalOpen(false)}
        onRename={renameFavourite}
        onDelete={deleteFavourite}
        onSelectFavourite={(addr) => {
          setDestination(addr);
          setIsManageModalOpen(false);
        }}
      />

      {isScannerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Scan destination QR</h3>
              <button
                type="button"
                onClick={closeScanner}
                className="text-xs text-slate-400 transition-colors hover:text-slate-200"
              >
                Close
              </button>
            </div>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="aspect-square w-full rounded-xl border border-slate-700 bg-slate-950 object-cover"
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
    </>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-confirmation-title"
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <h3
          id="send-confirmation-title"
          className="font-display text-lg font-semibold text-white"
        >
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
            <div className="flex items-center gap-2 rounded-lg border border-stellar-500/20 bg-stellar-500/10 px-3 py-2 text-stellar-400">
              <CheckIcon className="h-4 w-4" />
              <span className="text-xs font-medium">Recorded on-chain via Soroban</span>
            </div>
          )}
        </dl>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
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

interface FavouritesModalProps {
  isOpen: boolean;
  favourites: FavouriteEntry[];
  onClose: () => void;
  onSelectFavourite: (address: string) => void;
  onRename: (address: string, newName: string) => void;
  onDelete: (address: string) => void;
}

function FavouritesModal({
  isOpen,
  favourites,
  onClose,
  onSelectFavourite,
  onRename,
  onDelete,
}: FavouritesModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="favourites-modal-title"
        className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 mb-6">
          <h3 id="favourites-modal-title" className="font-display text-lg font-semibold text-white">
            Manage Favourites
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
          <p className="text-sm text-slate-300 mb-4">
            {favourites.length} saved recipient{favourites.length === 1 ? "" : "s"}
          </p>

          {favourites.length === 0 ? (
            <p className="text-sm text-slate-400">No favourites yet. Add some from the payment form.</p>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
              {favourites.map((item) => (
                <div
                  key={item.address}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-100 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500 font-mono truncate">{item.address}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectFavourite(item.address)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition-colors"
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newName = prompt("Enter new name:", item.name);
                        if (newName && newName !== item.name) {
                          onRename(item.address, newName);
                        }
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                      title="Rename"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove ${item.name} from favourites?`)) {
                          onDelete(item.address);
                        }
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
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
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
    </svg>
  );
}

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
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

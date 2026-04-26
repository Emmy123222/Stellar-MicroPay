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
  CONTRACT_ID,
  explorerUrl,
  fetchNetworkFeeStats,
  isValidStellarAddress,
  server,
  submitTransaction,
  fetchNetworkFeeStats,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatXLM, parseAddressBookCSV } from "@/utils/format";
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
  // FIX: Added prefill to interface to stop the "Property does not exist" error
  prefill?: {
    destination: string;
    amount: string;
    memo?: string;
    validUntil?: number;
    /** True when pre-filled from the "Send again" action in transaction history. */
    fromHistory?: boolean;
  } | null;
  // AI Assistant prefill
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

type ImportPreviewRow = {
  name: string;
  address: string;
  status: "valid" | "invalid" | "duplicate";
  reason: string;
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
    createInitialStepTimings
  );
  const [isScannerSupported, setIsScannerSupported] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [networkFeeXlm, setNetworkFeeXlm] = useState(0.00001);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const frameRequestRef = useRef<number | null>(null);
  const isDetectingRef = useRef(false);
  const lastInvalidScanRef = useRef<string | null>(null);

  const [recentRecipients, setRecentRecipients] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(RECENT_RECIPIENTS_KEY) ?? "[]");
    } catch {
      return [];
    }
  });

  const saveRecipient = (address: string) => {
    const updated = [address, ...recentRecipients.filter((a) => a !== address)].slice(0, MAX_RECENT);
    setRecentRecipients(updated);
    sessionStorage.setItem(RECENT_RECIPIENTS_KEY, JSON.stringify(updated));
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

    void loadFee();
    const intervalId = window.setInterval(() => {
      void loadFee();
    }, 60_000);

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

  useEffect(() => {
    const fetchFee = async () => {
      try {
        const stats = await fetchNetworkFeeStats();
        setNetworkFee(stats.baseFeeXlm.toFixed(5));
      } catch {
        setNetworkFee(null);
      }
    };
    fetchFee();
  }, []);

  const xlmBal = parseFloat(xlmBalance);
  const usdcBal = usdcBalance ? parseFloat(usdcBalance) : 0;
  // XLM has a 1 XLM reserve; USDC has no such constraint
  const balance = selectedAsset === "XLM" ? xlmBal : usdcBal;
  const maxSend = selectedAsset === "XLM" ? Math.max(0, xlmBal - 1) : usdcBal;

  const amountNum = parseFloat(amount);
  const hasAmount = Number.isFinite(amountNum) && amountNum > 0;
  const estimatedTotalDeducted = hasAmount ? amountNum + networkFeeXlm : null;
  const isValidDest = destination.length > 0 && isValidStellarAddress(destination);
  
  // Check if destination is a username (@username format)
  const isUsernameDestination = /^@?[a-zA-Z0-9]{3,20}$/.test(destination) && !isValidStellarAddress(destination);
  
  const MIN_STROOP = 0.0000001;
  const isValidAmt =
    !Number.isNaN(amountNum) && amountNum >= MIN_STROOP && amountNum <= maxSend;
  
  // Allow submission if valid address OR valid username being resolved
  const canSubmit =
    (isValidDest || (isUsernameDestination && !isResolvingUsername && !usernameResolutionError)) && 
    isValidAmt && status === "idle" && destination !== publicKey;

  // Resolve username to Stellar address
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
      const response = await fetch(
        `${apiBase}/api/accounts/resolve/${encodeURIComponent(cleanUsername)}`
      );
      
      if (!response.ok) {
        throw new Error("Username not found");
      }
      
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

  // Handle destination change with username resolution
  const handleDestinationChange = (value: string) => {
    setDestination(value);
    setUsernameResolutionError(null);
    
    // Auto-resolve username on blur if it looks like a username
    if (value.startsWith("@")) {
      resolveUsername(value);
    }
  };

  // Handle form submission with username resolution
  const handleSubmitWithResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isUsernameDestination) {
      await resolveUsername(destination);
    }
  };

  const resetTracker = () => {
    setStatus("idle");
  const saveFavourites = (items: FavouriteEntry[]) => {
    setFavourites(items);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(items));
    }
  };

  const normalizedAddress = (value: string) => value.trim().toUpperCase();

  const buildImportPreview = (items: Array<{ name: string; address: string }>) => {
    const existing = new Set(favourites.map((item) => normalizedAddress(item.address)));
    const seen = new Set<string>();
    const previewRows: ImportPreviewRow[] = [];
    let valid = 0;
    let invalid = 0;
    let duplicate = 0;

    items.forEach((item, index) => {
      const address = item.address.trim();
      const name = item.name.trim() || "(no name)";
      const normalized = normalizedAddress(address);
      const isValid = address.length > 0 && isValidStellarAddress(address);
      const isDuplicate = isValid && (existing.has(normalized) || seen.has(normalized));
      let status: ImportPreviewRow["status"];
      let reason = "";

      if (!address || !isValid) {
        status = "invalid";
        reason = "Invalid Stellar address";
        invalid += 1;
      } else if (isDuplicate) {
        status = "duplicate";
        reason = "Already in favourites";
        duplicate += 1;
      } else {
        status = "valid";
        reason = "Ready to import";
        valid += 1;
        seen.add(normalized);
      }

      if (previewRows.length < 5) {
        previewRows.push({ name, address, status, reason });
      }
    });

    setCsvPreview(previewRows);
    setCsvMeta({ total: items.length, valid, invalid, duplicate });
  };

  const handleFileSelection = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseAddressBookCSV(text);
      const rows = parsed.filter((row) => row.name || row.address);
      setParsedCsvRows(rows);
      buildImportPreview(rows);
      setPendingCsvFileName(file.name);
      setImportMessage(null);
    } catch {
      setParsedCsvRows([]);
      setCsvPreview([]);
      setCsvMeta(null);
      setImportMessage("Unable to parse CSV file. Please select a valid comma-separated file.");
      setPendingCsvFileName(null);
    }
  };

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleFileSelection(file);
    event.target.value = "";
  };

  const handleConfirmImport = () => {
    if (!csvMeta || parsedCsvRows.length === 0) return;

    const existing = new Set(favourites.map((item) => normalizedAddress(item.address)));
    const newEntries: FavouriteEntry[] = [];
    const seen = new Set<string>();

    parsedCsvRows.forEach((row) => {
      const address = row.address.trim();
      const name = row.name.trim() || row.address.trim();
      const normalized = normalizedAddress(address);

      if (!address || !isValidStellarAddress(address)) {
        return;
      }
      if (existing.has(normalized) || seen.has(normalized)) {
        return;
      }

      seen.add(normalized);
      newEntries.push({ name, address });
    });

    const importedCount = newEntries.length;
    const skippedCount = csvMeta.total - importedCount;

    if (importedCount > 0) {
      saveFavourites([...favourites, ...newEntries]);
    }

    setImportMessage(`${importedCount} imported, ${skippedCount} skipped`);
    setCsvPreview([]);
    setParsedCsvRows([]);
    setCsvMeta(null);
    setPendingCsvFileName(null);
    const fileInput = fileInputRef.current;
    if (fileInput) {
      fileInput.value = "";
    }
  };

  const handleSelectFavourite = (address: string) => {
    setDestination(address);
    setIsFavouritesModalOpen(false);
  };

  const openFavouritesModal = () => {
    setImportMessage(null);
    setCsvPreview([]);
    setCsvMeta(null);
    setPendingCsvFileName(null);
    setIsFavouritesModalOpen(true);
  };

  const closeFavouritesModal = () => {
    setIsFavouritesModalOpen(false);
    setCsvPreview([]);
    setCsvMeta(null);
    setPendingCsvFileName(null);
    setImportMessage(null);
  };

  const executeSend = async () => {
    if (!canSubmit) return;
    setError(null);
    setTxHash(null);
    setFailedStep(null);
    setStepTimings(createInitialStepTimings());
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
          fromPublicKey: publicKey,
          toPublicKey: destination,
          amount: amountNum.toFixed(7),
          memo: memo.trim() || undefined,
        });

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
      onSuccess?.(result.hash);
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

  return (
    <>
      <div className="card animate-fade-in">
        <h2 className="mb-6 flex items-center gap-2 font-display text-lg font-semibold text-white">
          <SendIcon className="h-5 w-5 text-stellar-400" />
          {`Send Payment`}
        </h2>

        <div className="space-y-5">
          <div className="flex gap-2 flex-wrap">
            {(["XLM", "USDC"] as AssetType[]).map((asset) => (
              <button
                key={asset}
                type="button"
                onClick={() => {
                  setSelectedAsset(asset);
                  setAmount("");
                  if (asset === "CUSTOM") {
                    setShowCustomAssetForm(true);
                  } else {
                    setShowCustomAssetForm(false);
                  }
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
                  <span className="ml-1 text-xs">No balance</span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setSelectedAsset("CUSTOM");
                setShowCustomAssetForm(true);
                setAmount("");
              }}
              className={clsx(
                "rounded-full border px-4 py-1.5 text-sm font-medium transition-all",
                selectedAsset === "CUSTOM"
                  ? "border-stellar-500/30 bg-stellar-500/15 text-stellar-300"
                  : "border-white/10 text-slate-400 hover:border-white/20"
              )}
            >
              + Custom
            </button>
          </div>

          {/* Custom Asset Form */}
          {showCustomAssetForm && (
            <div className="p-4 rounded-lg border border-purple-500/20 bg-purple-500/5 space-y-3">
              <p className="text-sm font-medium text-purple-300">Custom Stellar Asset</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Asset Code</label>
                  <input
                    type="text"
                    value={customAsset.code}
                    onChange={(e) => setCustomAsset({ ...customAsset, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. COIN"
                    className="input-field text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Issuer Address</label>
                  <input
                    type="text"
                    value={customAsset.issuer}
                    onChange={(e) => setCustomAsset({ ...customAsset, issuer: e.target.value.trim() })}
                    placeholder="G..."
                    className="input-field text-sm font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {selectedAsset === "CUSTOM" && (!customAsset.code || !customAsset.issuer) && (
            <p className="text-xs text-amber-400">Enter both asset code and issuer address for custom assets</p>
          )}
        </div>
      </div>

      {/* QR Scanner */}
      <div className="mt-4">
        {!hideDestinationField && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowScanner(!showScanner)}
              className="text-xs text-stellar-400 hover:text-stellar-300 flex items-center gap-1"
            >
              <CameraIcon className="w-4 h-4" />
              {showScanner ? "Close scanner" : "Scan QR code"}
            </button>
          </div>
        )}
      </div>

      {showScanner && (
        <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
          <div className="relative aspect-square max-w-sm mx-auto bg-black rounded-lg overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-48 h-48 border-2 border-stellar-400 rounded-lg" />
            </div>
          </div>
          <p className="text-xs text-slate-400 text-center mt-2">
            Point your camera at a QR code
          </p>
          {scannerError && (
            <p className="mt-2 text-xs text-red-400 text-center">{scannerError}</p>
          )}
        </div>
      )}

      {scannerError && (
        <p className="mt-2 text-xs text-red-400">{scannerError}</p>
      )}

      {showScanner || showFavourites || showCsvImport ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setShowScanner(false);
              setShowFavourites(false);
              setShowCsvImport(false);
            }}
            className="text-xs text-slate-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>

    {/* Payment Confirmation Modal */}
    <PaymentStatusModal
      isOpen={isStatusModalOpen}
      onClose={() => {
        setIsStatusModalOpen(false);
        if (status === "success") {
          resetTracker();
          if (onSuccess) onSuccess(txHash ?? undefined);
        }
      }}
      status={status}
      stepTimings={stepTimings}
      txHash={txHash}
      error={error}
      failedStep={failedStep}
      isTipOnChain={isTipOnChain}
    />
  </>
);

  function stopScanner() {
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
  }

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
        {/* Confetti burst on payment success (#169). CSS-only, plays once,
            self-stops after ~2s via the keyframe `forwards`. */}
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={i} className={`confetti__piece confetti__piece--${i}`} />
          ))}
        </div>
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
          <CheckIcon className="w-7 h-7 text-emerald-400" />
        </div>
        <h3 className="font-display text-lg font-semibold text-white mb-1">
          {successTitle}
        </h3>
        <p className="text-slate-400 text-sm mb-4">
          {successMessage || `${formatXLM(amount)} sent successfully`}
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <a
            href={explorerUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-stellar-400 hover:text-stellar-300 transition-colors"
          >
            {`View on Stellar Expert`}
            <ExternalLinkIcon className="w-3.5 h-3.5" />
          </a>

          <button
            type="button"
            onClick={handleCopy}
            title={txHash}
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            {copied ? (
              <span className="text-emerald-400">{`Copied!`}</span>
            ) : (
              <>
                <CopyIcon className="w-3.5 h-3.5" />
                <span className="font-mono">{truncatedHash}</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card animate-fade-in">
      <h2 className="font-display text-lg font-semibold text-white mb-6 flex items-center gap-2">
        <SendIcon className="w-5 h-5 text-stellar-400" />
        {title}
      </h2>

      <div className="space-y-5">
        {/* Asset selector */}
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
                {a === "USDC" && !usdcBalance && (
                  <span className="ml-1 text-xs">(no trustline)</span>
                )}
              </button>
            ))}
          </div>

        )}



        {/* Pre-fill notice */}
        {prefill?.fromHistory && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stellar-500/10 border border-stellar-500/20 text-stellar-400 text-xs">
            <InfoIcon className="w-3.5 h-3.5 flex-shrink-0" />
            Pre-filled from transaction history
          </div>
        )}

        {/* Destination */}
        {!hideDestinationField && (
          <div>
            <label className="label">{`Recipient Address or @username`}</label>
            <div className="relative">
              <input
                type="text"
                value={destination}
                onChange={(e) => handleDestinationChange(e.target.value.trim())}
                onBlur={() => {
                  if (destination.startsWith("@")) {
                    resolveUsername(destination);
                  }
                }}
                placeholder="G... (Stellar address) or @username"
                className={clsx(
                  "input-field pr-10",
                  destination.length > 0 && !isValidDest && !isUsernameDestination && "border-red-500/50"
                )}
                disabled={destinationReadOnly || status !== "idle"}
                readOnly={destinationReadOnly}
              />
              {isResolvingUsername && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {destination.startsWith("@") && !isResolvingUsername && isValidDest && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
            {usernameResolutionError && (
              <p className="mt-1 text-xs text-red-400">{usernameResolutionError}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Enter a Stellar address (G...) or @username to send payment
            </p>
            {destination.length > 0 && !isValidDest && !isUsernameDestination && (
              <p className="mt-1 text-xs text-red-400">{`Invalid Stellar address`}</p>
            )}
            {destination === publicKey && (
              <p className="mt-1 text-xs text-amber-400">{`You cannot send to yourself`}</p>
            )}
          </div>
        )}

        {favourites.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
            <p className="label mb-2">Favourite recipients</p>
            <div className="flex flex-wrap gap-2">
              {favourites.slice(0, 6).map((item) => (
                <button
                  key={item.address}
                  type="button"
                  onClick={() => setDestination(item.address)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200 hover:bg-white/10 transition-colors"
                >
                  {item.name} • {item.address.slice(0, 6)}...
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent recipients */}
        {recentRecipients.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="label mb-0">Recent recipients</span>
              <button
                type="button"
                onClick={clearRecipients}
                className="text-xs text-slate-500 hover:text-red-400 transition-colors"
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
                  className="px-3 py-1.5 rounded-full border border-stellar-500/20 bg-stellar-500/5 text-stellar-300 text-xs font-mono hover:border-stellar-500/50 hover:bg-stellar-500/10 transition-all"
                >
                  {addr.slice(0, 4)}…{addr.slice(-4)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Amount */}
        {!hideAmountField && (
          <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">{`Amount (${selectedAsset})`}</label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="label mb-0">{`Amount (${selectedAsset})`}</label>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={setMaxAmount}
                  className="text-xs text-stellar-400 transition-colors hover:text-stellar-300"
                  disabled={status !== "idle"}
                >
                  {`Max: ${formatXLM(Math.max(0, balance - 1))}`}
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
                      "rounded-lg border border-stellar-500/20 bg-cosmos-800 px-3 py-2 shadow-lg",
                      "text-xs leading-relaxed text-slate-300",
                      "scale-95 opacity-0 transition-all duration-150",
                      "group-hover:scale-100 group-hover:opacity-100",
                      "group-focus-within:scale-100 group-focus-within:opacity-100"
                    )}
                  >
                    {`Stellar requires a 1 XLM minimum balance in your account. The Max amount excludes this reserve.`}
                    <span className="absolute -bottom-1.5 right-3 h-3 w-3 rotate-45 border-b border-r border-stellar-500/20 bg-cosmos-800" />
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
            {selectedAsset === "XLM" && (
              <div className="mt-2 rounded-lg border border-stellar-500/20 bg-stellar-500/5 px-3 py-2 text-xs text-slate-300">
                <p>
                  Network fee:{" "}
                  <span className="font-medium text-stellar-300">
                    ~{networkFeeXlm.toFixed(7)} XLM
                  </span>
                </p>
                {estimatedTotalDeducted !== null && (
                  <p className="mt-1">
                    Total deducted:{" "}
                    <span className="font-medium text-white">
                      ~{estimatedTotalDeducted.toFixed(7)} XLM
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="label">{`Memo (optional)`}</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value.slice(0, 28))}
              placeholder="Payment note..."
              maxLength={28}
              className="input-field"
              disabled={status !== "idle"}
            />
            <p
              className={clsx(
                "mt-1 text-xs",
                memo.length >= 28
                  ? "text-red-400"
                  : memo.length >= 25
                  ? "text-red-400"
                  : memo.length >= 20
                  ? "text-amber-400"
                  : "text-slate-500"
              )}
              title="Stellar memos are limited to 28 bytes"
            >
              {memo.length >= 28
                ? "Max reached (28 chars)"
                : `${memo.length}/28 characters`}
            </p>
          </div>
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
          <div className="relative">
            <input
              type="text"
              value={memo}
              onChange={(e) => handleMemoChange(e.target.value.slice(0, 28))}
              placeholder="Payment note..."
              maxLength={28}
              className="input-field pr-10"
              disabled={status !== "idle"}
            />
            <span
              title="Stellar memos are limited to 28 bytes — this keeps transactions compatible with the Stellar network."
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 cursor-help select-none"
              aria-label="Stellar memo byte limit info"
            >
              ℹ
            </span>
          </div>

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

          <p
            className={clsx(
              "mt-1 text-xs",
              memo.length >= 28
                ? "text-red-400"
                : memo.length >= 25
                ? "text-red-400"
                : memo.length >= 20
                ? "text-amber-400"
                : "text-slate-500"
            )}
          >
            {memo.length >= 28
              ? "Max reached (28 chars)"
              : `${memo.length}/28 characters`}
          </p>
        </div>

        {/* Record as Tip On-Chain (Soroban) */}
        {/* {CONTRACT_ID && (
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
        )} */}

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
                {`Send ${amount ? formatXLM(amountNum) : ""} ${selectedAsset}`.trim()}
              </>
            )}
            {status === "success" && "Payment complete"}
            {status === "error" && "Review payment status"}
          </button>

          {status === "signing" && (
            <p className="animate-pulse text-center text-xs text-slate-400">
              {`Please confirm the transaction in your Freighter wallet...`}
            </p>
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
              {submitLabel || `Send ${amount ? formatXLM(amountNum) : ""} ${selectedAsset}`.trim()}
            </>
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
      </div>

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
    </>
  );
}

async function waitForTransactionConfirmation(hash: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await server.transactions().transaction(hash).call();
      return;
    } catch (err: unknown) {
      const horizonErr = err as { response?: { status?: number } };

      if (horizonErr?.response?.status === 404) {
        await sleep(1500);
        continue;
      }

      throw new Error("Unable to confirm the transaction on the Stellar network.");
    }
  }

  throw new Error(
    "Confirmation is taking longer than expected. Please check Stellar Expert for the final result."
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFileInputChange}
      />

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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  onOpenFilePicker: () => void;
  pendingFileName: string | null;
  previewRows: ImportPreviewRow[];
  meta: { valid: number; invalid: number; duplicate: number; total: number } | null;
  importMessage: string | null;
  onConfirmImport: () => void;
}

function FavouritesModal({
  isOpen,
  favourites,
  onClose,
  onSelectFavourite,
  onOpenFilePicker,
  pendingFileName,
  previewRows,
  meta,
  importMessage,
  onConfirmImport,
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
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
          <div>
            <h3 id="favourites-modal-title" className="font-display text-lg font-semibold text-white">
              Manage favourites
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Import a CSV file with columns <strong>name</strong> and <strong>address</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-300">Current favourites</p>
                  <p className="text-xs text-slate-500">
                    {favourites.length} saved recipient{favourites.length === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenFilePicker}
                  className="btn-secondary text-sm px-3 py-2"
                >
                  Import from CSV
                </button>
              </div>

              {favourites.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">No favourites yet. Import a CSV or add recipients manually.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {favourites.slice(0, 8).map((item) => (
                    <div
                      key={item.address}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3"
                    >
                      <div>
                        <p className="text-sm text-slate-100">{item.name}</p>
                        <p className="text-xs text-slate-500 break-all">{item.address}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectFavourite(item.address)}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200 hover:bg-white/10 transition-colors"
                      >
                        Use
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {pendingFileName && (
              <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
                <p className="text-sm text-slate-300">Selected file</p>
                <p className="mt-1 text-sm text-slate-100">{pendingFileName}</p>
                {meta && (
                  <p className="mt-2 text-sm text-slate-400">
                    {`${meta.valid} valid, ${meta.invalid + meta.duplicate} skipped`}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <p className="text-sm text-slate-300 mb-3">Preview (first 5 rows)</p>
            {previewRows.length === 0 ? (
              <p className="text-sm text-slate-400">No import preview available.</p>
            ) : (
              <div className="space-y-3">
                {previewRows.map((row, index) => (
                  <div key={`${row.address}-${index}`} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm text-slate-100">{row.name}</p>
                        <p className="text-xs text-slate-500 break-all">{row.address}</p>
                      </div>
                      <span
                        className={clsx(
                          "rounded-full px-2 py-1 text-[11px] font-semibold",
                          row.status === "valid" && "bg-emerald-500/15 text-emerald-300",
                          row.status === "invalid" && "bg-red-500/10 text-red-300",
                          row.status === "duplicate" && "bg-amber-500/10 text-amber-300"
                        )}
                      >
                        {row.reason}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {importMessage && (
              <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/70 p-3 text-sm text-slate-200">
                {importMessage}
              </div>
            )}

            <button
              type="button"
              onClick={onConfirmImport}
              disabled={!meta || meta.valid === 0}
              className="mt-4 w-full btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {`Confirm import`}
            </button>
          </div>
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

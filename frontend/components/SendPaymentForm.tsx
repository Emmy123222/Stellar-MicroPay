/**
 * components/SendPaymentForm.tsx
 * Form for sending XLM payments to any Stellar address.
 *
 * Issue #8 - Add a 'Send Max' button tooltip explaining the 1 XLM reserve
 * Emmy123222/Stellar-MicroPay
 */

import ContactPickerModal from "@/components/ContactPickerModal";
import PaymentStatusModal, {
  type PaymentFlowStatus,
  type PaymentStepId,
  type PaymentStepTiming,
} from "@/components/PaymentStatusModal";
import {
  buildPaymentTransaction,
  buildReceiptMintTransaction,
  buildSorobanTipTransaction,
  explorerUrl,
  fetchNetworkFeeStats,
  isValidStellarAddress,
  memoTextByteLength,
  memoValueError,
  server,
  STELLAR_BASE_FEE_XLM,
  STELLAR_MEMO_HASH_HEX_LENGTH,
  STELLAR_MEMO_PLACEHOLDERS,
  STELLAR_MEMO_TEXT_MAX_BYTES,
  type StellarMemoType,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM,
  submitTransaction,
  truncateMemoText,
  type StellarMemoType,
} from "@/lib/stellar";
import { Federation } from "@stellar/stellar-sdk";
import { parseHorizonSubmissionError } from "@/lib/horizonErrors";
import { signTransactionWithWallet } from "@/lib/wallet";
import { resolveSNSDomain } from "@/utils/snsResolver";
import { formatXLM, shortenAddress } from "@/utils/format";
import { AssetBadge } from "@/components/AssetBadge";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

interface SendPaymentFormProps {
  publicKey?: string;
  xlmBalance?: string;
  /** Non-XLM/non-USDC balances, used to warn when sending more than held. */
  accountBalances?: Array<{ code: string; issuer: string; balance: string }>;
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

const ESTIMATED_NETWORK_FEE = `${STELLAR_BASE_FEE_XLM} XLM`;
const FAVOURITES_STORAGE_KEY = "stellar-micropay:favourites";

interface BarcodeDetectorResult {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<BarcodeDetectorResult[]>;
}

const RECENT_RECIPIENTS_KEY = "stellar-micropay:recent-destinations";
const MAX_RECENT = 5;

function createInitialStepTimings(): Record<PaymentStepId, PaymentStepTiming> {
  return {
    building: { startedAt: null, completedAt: null, error: null },
    signing: { startedAt: null, completedAt: null, error: null },
    submitting: { startedAt: null, completedAt: null, error: null },
    confirming: { startedAt: null, completedAt: null, error: null },
  };
}

export default function SendPaymentForm({
  publicKey = "",
  xlmBalance = "0",
  accountBalances,
  usdcBalance,
  onSuccess,
  prefill,
  title,
  submitLabel,
  successTitle,
  successMessage,
  assetOptions = ["XLM", "USDC"],
  hideAssetSelector = false,
  hideDestinationField = false,
  destinationReadOnly = false,
  hideAmountField = false,
  hideMemoField = false,
}: SendPaymentFormProps) {
  const { t } = useTranslation();
  const [selectedAsset, setSelectedAsset] = useState<AssetType>("XLM");
  const [networkFeeXlm, setNetworkFeeXlm] = useState(STELLAR_BASE_FEE_XLM);
  const [feeStatus, setFeeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [memoType, setMemoType] = useState<StellarMemoType>("text");
  const [memoError, setMemoError] = useState<string | null>(null);
  const [isResolvingUsername, setIsResolvingUsername] = useState(false);
  const [usernameResolutionError, setUsernameResolutionError] = useState<string | null>(null);

  // SNS (.xlm domain) resolution (#1197)
  const [isResolvingSNS, setIsResolvingSNS] = useState(false);
  const [snsResolvingDomain, setSnsResolvingDomain] = useState<string | null>(null);
  const [snsResolvedAddress, setSnsResolvedAddress] = useState<string | null>(null);
  const [snsError, setSnsError] = useState<string | null>(null);
  const snsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [mintingReceipt, setMintingReceipt] = useState(false);
  const [receiptMinted, setReceiptMinted] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [isScannerSupported, setIsScannerSupported] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  
  // Split payment mode
  const [isSplitPaymentMode, setIsSplitPaymentMode] = useState(false);
  const [splitRecipients, setSplitRecipients] = useState<Array<{ address: string; percentage: number }>>([
    { address: "", percentage: 100 }
  ]);
  
  // Federation address lookup
  const [isResolvingFederation, setIsResolvingFederation] = useState(false);
  const [federationResolvedAddress, setFederationResolvedAddress] = useState<string | null>(null);
  const [federationError, setFederationError] = useState<string | null>(null);
  const federationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isContactPickerOpen, setIsContactPickerOpen] = useState(false);

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
      setScannerError(t("sendPayment.cameraError"));
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
        const parsed = JSON.parse(localStorage.getItem(RECENT_RECIPIENTS_KEY) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT) : [];
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
  const [isRecentDropdownOpen, setIsRecentDropdownOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const contactSuggestions = hideDestinationField
    ? []
    : favourites
        .filter(
          (f) =>
            destination.length > 0 &&
            (f.name.toLowerCase().includes(destination.toLowerCase()) ||
              f.address.startsWith(destination))
        )
        .slice(0, 5);
  const handleDestinationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!contactSuggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveSuggestion((i) => (i + 1) % contactSuggestions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveSuggestion((i) => (i - 1 + contactSuggestions.length) % contactSuggestions.length); }
    else if (e.key === "Enter" && contactSuggestions[activeSuggestion]) { e.preventDefault(); setDestination(contactSuggestions[activeSuggestion].address); setActiveSuggestion(0); }
    else if (e.key === "Escape") { setActiveSuggestion(0); setDestination(""); }
  };
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
        setIsRecentDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const saveRecipient = (address: string) => {
    const updated = [address, ...recentRecipients.filter((a) => a !== address)].slice(0, MAX_RECENT);
    setRecentRecipients(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem(RECENT_RECIPIENTS_KEY, JSON.stringify(updated));
    }
  };

  const clearRecipients = () => {
    setRecentRecipients([]);
    localStorage.removeItem(RECENT_RECIPIENTS_KEY);
    setIsRecentDropdownOpen(false);
  };

  const memoTemplates = ["Rent", "Salary", "Invoice", "Gift", "Coffee ☕"];

  const handleMemoTypeChange = (nextType: StellarMemoType) => {
    setMemoType(nextType);
    setMemo("");
    setSelectedMemoTemplate(null);
    setMemoError(null);
  };

  const validateMemoValue = (type: StellarMemoType, value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (type === "id") {
      if (!/^\d+$/.test(trimmed)) return "MEMO_ID must be a uint64 integer";
      return null;
    }
    if (type === "hash" || type === "return") {
      const hex = trimmed.toLowerCase().replace(/^0x/, "");
      if (!/^[0-9a-f]*$/.test(hex)) return `MEMO_${type.toUpperCase()} must be hexadecimal`;
      if (hex.length !== STELLAR_MEMO_HASH_HEX_LENGTH) {
        return `MEMO_${type.toUpperCase()} requires ${STELLAR_MEMO_HASH_HEX_LENGTH} hex characters (32 bytes)`;
      }
      return null;
    }
    return null;
  };

  const handleMemoTemplateClick = (template: string) => {
    if (memoType !== "text") return;
    if (selectedMemoTemplate === template) {
      setSelectedMemoTemplate(null);
      setMemo("");
      return;
    }
    setSelectedMemoTemplate(template);
    setMemo(template);
    setMemoError(null);
  };

  const handleMemoChange = (value: string) => {
    let next = value;
    if (memoType === "text") {
      next = truncateMemoText(value);
    } else if (memoType === "id") {
      next = value.replace(/\D/g, "");
    } else {
      next = value.replace(/[^0-9a-fA-Fx]/g, "").slice(0, STELLAR_MEMO_HASH_HEX_LENGTH + 2);
    }
    setMemo(next);
    setMemoError(validateMemoValue(memoType, next));
    if (next !== selectedMemoTemplate) {
      setSelectedMemoTemplate(null);
    }
  };

  const memoPlaceholder =
    memoType === "text"
      ? "Payment note..."
      : memoType === "id"
        ? "uint64 integer, e.g. 12345"
        : "64-character hex (32 bytes)";

  const isMemoValid = !memo.trim() || !validateMemoValue(memoType, memo);

  useEffect(() => {
    let cancelled = false;
    const loadFee = async () => {
      try {
        const feeStats = await fetchNetworkFeeStats();
        if (!cancelled) {
          setNetworkFeeXlm(feeStats.baseFeeXlm || STELLAR_BASE_FEE_XLM);
          setFeeStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setNetworkFeeXlm(STELLAR_BASE_FEE_XLM);
          setFeeStatus("error");
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
    if (prefill.memo) setMemo(truncateMemoText(prefill.memo));
  }, [prefill]);

  const xlmBal = parseFloat(xlmBalance);
  const usdcBal = usdcBalance ? parseFloat(usdcBalance) : 0;
  const balance = selectedAsset === "XLM" ? xlmBal : usdcBal;
  const maxSend =
    selectedAsset === "XLM"
      ? Math.max(0, xlmBal - STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM)
      : usdcBal;

  const amountNum = parseFloat(amount);
  const hasAmount = Number.isFinite(amountNum) && amountNum > 0;
  const estimatedTotalDeducted = hasAmount ? amountNum + networkFeeXlm : null;
  const isValidDest = destination.length > 0 && isValidStellarAddress(destination);

  const isUsernameDestination = /^@?[a-zA-Z0-9]{3,20}$/.test(destination) && !isValidStellarAddress(destination);
  const isSNSDestination = destination.toLowerCase().endsWith(".xlm");

  const MIN_STROOP = 0.0000001;
  const isValidAmt = !Number.isNaN(amountNum) && amountNum >= MIN_STROOP && amountNum <= maxSend;

  const canSubmit = (isValidDest || (isUsernameDestination && !isResolvingUsername && !usernameResolutionError)) &&
    isValidAmt && isMemoValid && status === "idle" && destination !== publicKey;

  const resolveUsername = async (username: string) => {
    const cleanUsername = username.replace(/^@/, "").toLowerCase();
    if (!/^[a-zA-Z0-9]{3,20}$/.test(cleanUsername)) {
      setUsernameResolutionError(t("sendPayment.invalidUsername"));
      return;
    }
    setIsResolvingUsername(true);
    setUsernameResolutionError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      const response = await fetch(`${apiBase}/api/accounts/resolve/${encodeURIComponent(cleanUsername)}`);
      if (!response.ok) throw new Error(t("sendPayment.usernameNotFound"));
      const payload = await response.json();
      if (payload?.success && payload?.data?.publicKey) {
        setDestination(payload.data.publicKey);
        setUsernameResolutionError(null);
      } else {
        throw new Error(t("sendPayment.usernameResolveFailed"));
      }
    } catch (err) {
      setUsernameResolutionError(
        err instanceof Error ? err.message : t("sendPayment.usernameResolveFailed")
      );
    } finally {
      setIsResolvingUsername(false);
    }
  };

  // SNS (.xlm domain) resolution with debounce (#1197)
  useEffect(() => {
    if (snsDebounceRef.current) {
      clearTimeout(snsDebounceRef.current);
    }

    const isSNSDomain = destination.toLowerCase().endsWith(".xlm");

    if (!isSNSDomain || isValidStellarAddress(destination)) {
      setSnsResolvedAddress(null);
      setSnsError(null);
      setIsResolvingSNS(false);
      setSnsResolvingDomain(null);
      return;
    }

    const domain = destination.trim().toLowerCase();
    setIsResolvingSNS(true);
    setSnsResolvingDomain(domain);
    setSnsResolvedAddress(null);
    setSnsError(null);

    snsDebounceRef.current = setTimeout(async () => {
      try {
        const address = await resolveSNSDomain(domain);
        if (address) {
          setSnsResolvedAddress(address);
          setSnsError(null);
        } else {
          setSnsResolvedAddress(null);
          setSnsError("SNS name not found");
        }
      } catch {
        setSnsResolvedAddress(null);
        setSnsError("SNS name not found");
      } finally {
        setIsResolvingSNS(false);
      }
    }, 100);

    return () => {
      if (snsDebounceRef.current) {
        clearTimeout(snsDebounceRef.current);
      }
    };
  }, [destination]);

  const handleUseSNSAddress = () => {
    if (snsResolvedAddress) {
      setDestination(snsResolvedAddress);
      setSnsResolvedAddress(null);
      setSnsError(null);
    }
  };

  // Federation address lookup with debounce
  useEffect(() => {
    if (federationDebounceRef.current) {
      clearTimeout(federationDebounceRef.current);
    }

    const isFederationAddress = destination.includes("*") && !isValidStellarAddress(destination);
    
    if (!isFederationAddress) {
      setFederationResolvedAddress(null);
      setFederationError(null);
      return;
    }

    setIsResolvingFederation(true);
    setFederationError(null);
    setFederationResolvedAddress(null);

    federationDebounceRef.current = setTimeout(async () => {
      try {
        const [name, domain] = destination.split("*");
        if (!name || !domain) {
          setFederationError("Invalid federation address format");
          setIsResolvingFederation(false);
          return;
        }

        // Federation.Server.resolve takes the full "name*domain" federation address.
        const result = await Federation.Server.resolve(`${name}*${domain}`);
        if (result.account_id) {
          setFederationResolvedAddress(result.account_id);
        } else {
          setFederationError("Federation address not found");
        }
      } catch (err) {
        setFederationError("Federation address not found");
      } finally {
        setIsResolvingFederation(false);
      }
    }, 500);

    return () => {
      if (federationDebounceRef.current) {
        clearTimeout(federationDebounceRef.current);
      }
    };
  }, [destination]);

  const handleUseFederationAddress = () => {
    if (federationResolvedAddress) {
      setDestination(federationResolvedAddress);
      setFederationResolvedAddress(null);
      setFederationError(null);
    }
  };

  // Split payment handlers
  const handleAddSplitRecipient = () => {
    if (splitRecipients.length >= 10) return;
    const currentTotal = splitRecipients.reduce((sum, r) => sum + r.percentage, 0);
    const remainingPercentage = Math.max(0, 100 - currentTotal);
    setSplitRecipients([...splitRecipients, { address: "", percentage: remainingPercentage }]);
  };

  const handleRemoveSplitRecipient = (index: number) => {
    const newRecipients = splitRecipients.filter((_, i) => i !== index);
    if (newRecipients.length === 0) {
      setSplitRecipients([{ address: "", percentage: 100 }]);
    } else {
      // Redistribute percentages
      const total = newRecipients.reduce((sum, r) => sum + r.percentage, 0);
      if (total < 100) {
        newRecipients[0].percentage += (100 - total);
      }
      setSplitRecipients(newRecipients);
    }
  };

  const handleUpdateSplitRecipient = (index: number, field: "address" | "percentage", value: string | number) => {
    const newRecipients = [...splitRecipients];
    if (field === "percentage") {
      const numValue = Number(value);
      newRecipients[index].percentage = Math.max(0, Math.min(100, numValue));
    } else {
      newRecipients[index].address = value as string;
    }
    setSplitRecipients(newRecipients);
  };

  const totalSplitPercentage = splitRecipients.reduce((sum, r) => sum + r.percentage, 0);
  const splitPaymentsValid = splitRecipients.every(r => r.address && isValidStellarAddress(r.address)) && totalSplitPercentage === 100;

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
      setMemoType("text");
      setMemoError(null);
    }
    setStatus("idle");
  };

  const mintNftReceipt = async () => {
    if (!txHash) return;
    setMintingReceipt(true);
    setReceiptError(null);
    try {
      const tx = await buildReceiptMintTransaction({
        fromPublicKey: publicKey,
        toPublicKey: destination,
        amount: amountNum.toFixed(7),
        memo: memo.trim() || undefined,
      });
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR)
        throw new Error(signError || t("sendPayment.receiptSigningFailed"));
      const result = await submitTransaction(signedXDR);
      setReceiptMinted(true);
    } catch (err: any) {
      setReceiptError(err?.message || t("sendPayment.receiptMintFailed"));
    } finally {
      setMintingReceipt(false);
    }
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
            memoType,
          });
      markStepCompleted("building");

      activeStep = "signing";
      markStepStarted("signing");
      setStatus("signing");
      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR)
        throw new Error(signError || t("sendPayment.signingFailed"));
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
      const { message } = parseHorizonSubmissionError(err);
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
    if (!confirmed) throw new Error(t("sendPayment.confirmationTimedOut"));
  };

  const setMaxAmount = () => setAmount(maxSend.toFixed(7));

  const openConfirmation = () => {
    if (!canSubmit) return;
    setIsConfirmOpen(true);
  };

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
        <h2 className="mb-2 font-display text-2xl font-bold text-white">
          {successTitle ?? t("sendPayment.successTitle")}
        </h2>
        <p className="mb-6 text-slate-400">
          {successMessage ?? t("sendPayment.successMessage")}
        </p>

        <div className="mb-8 rounded-xl border border-white/5 bg-white/5 p-4">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {t("sendPayment.transactionHash")}
          </p>
          <div className="flex items-center justify-center gap-2">
            <code className="text-xs text-stellar-300">{truncatedHash}</code>
            <button onClick={handleCopy} className="text-slate-500 hover:text-white transition-colors">
              {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-400" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <a href={explorerUrl(txHash)} target="_blank" rel="noopener noreferrer" className="btn-primary flex items-center justify-center gap-2">
            {t("sendPayment.viewOnExplorer")} <ExternalLinkIcon className="h-4 w-4" />
          </a>

          {!receiptMinted ? (
            <button
              onClick={() => void mintNftReceipt()}
              disabled={mintingReceipt}
              className="btn-secondary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mintingReceipt ? (
                <>
                  <div className="w-4 h-4 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
                  {t("sendPayment.mintingReceipt")}
                </>
              ) : (
                <>
                  <ReceiptIcon className="h-4 w-4" />
                  {t("sendPayment.mintReceipt")}
                </>
              )}
            </button>
          ) : (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 text-center">
              {t("sendPayment.mintSuccess")}
            </div>
          )}

          {receiptError && (
            <p className="text-xs text-red-400 text-center">{receiptError}</p>
          )}

          <button onClick={() => setStatus("idle")} className="text-sm text-slate-400 hover:text-white transition-colors">
            {t("sendPayment.sendAnother")}
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
        {title ?? t("sendPayment.title")}
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
              <label className="label mb-0">{t("sendPayment.destination")}</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFavouritesDropdownOpen(!isFavouritesDropdownOpen)}
                  className="text-xs text-stellar-400 hover:text-stellar-300"
                >
                  {isFavouritesDropdownOpen
                    ? t("common.close")
                    : t("sendPayment.favourites")}
                </button>
                {isValidDest && (
                  <button
                    type="button"
                    onClick={() => {
                      const existing = favourites.find((f) => f.address === destination);
                      if (existing) deleteFavourite(destination);
                      else {
                        const name = prompt(
                          t("sendPayment.nameFavouritePrompt"),
                          destination.slice(0, 8)
                        );
                        if (name) saveFavourites([...favourites, { name, address: destination }]);
                      }
                    }}
                    className="text-stellar-400 hover:text-stellar-300"
                    title={
                      favourites.some((f) => f.address === destination)
                        ? t("sendPayment.removeFavourite")
                        : t("sendPayment.addFavourite")
                    }
                  >
                    <StarIcon className="h-5 w-5" filled={favourites.some((f) => f.address === destination)} />
                  </button>
                )}
                {isScannerSupported && status === "idle" && (
                  <button
                    type="button"
                    onClick={openScanner}
                    className="text-slate-400 hover:text-white"
                    title={t("sendPayment.scanQr")}
                  >
                    <QrCodeIcon className="h-5 w-5" />
                  </button>
                )}
                {status === "idle" && (
                  <button
                    type="button"
                    onClick={() => setIsContactPickerOpen(true)}
                    className="text-slate-400 hover:text-white"
                    title="Pick from address book"
                    aria-label="Pick from address book"
                    data-testid="open-contact-picker"
                  >
                    <ContactsIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>

            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              onFocus={() => setIsRecentDropdownOpen(recentRecipients.length > 0)}
              onKeyDown={handleDestinationKeyDown}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={contactSuggestions.length > 0}
              aria-controls="destination-suggestions"
              placeholder="G... or alice.xlm"
              className={clsx("input-field font-mono text-sm", destination && !isValidDest && !isUsernameDestination && !isSNSDestination && "border-red-500/50")}
              disabled={status !== "idle" || destinationReadOnly}
            />

            {isRecentDropdownOpen && recentRecipients.length > 0 && contactSuggestions.length === 0 && (
              <div role="listbox" aria-label="Recent destinations" className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl">
                <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent destinations</p>
                {recentRecipients.map((address) => (
                  <button
                    key={address}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { setDestination(address); setIsRecentDropdownOpen(false); }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left font-mono text-sm text-slate-200 hover:bg-white/5"
                  >
                    <span>{shortenAddress(address, 10)}</span>
                  </button>
                ))}
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={clearRecipients} className="w-full border-t border-white/10 px-3 py-2 text-left text-xs font-medium text-red-300 hover:bg-white/5">
                  Clear history
                </button>
              </div>
            )}

            {isResolvingSNS && snsResolvingDomain && (
              <p className="text-xs text-slate-400" role="status">
                Resolving {snsResolvingDomain}…
              </p>
            )}
            {snsResolvedAddress && (
              <div className="flex items-center justify-between gap-2">
                <span className="bg-green-100 rounded-lg px-3 py-2 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-200">
                  Resolved: {snsResolvedAddress}
                </span>
                <button
                  type="button"
                  onClick={handleUseSNSAddress}
                  className="text-xs font-semibold text-green-900 underline hover:text-green-700 dark:text-green-100 dark:hover:text-green-300"
                >
                  Use address
                </button>
              </div>
            )}
            {snsError && (
              <p className="text-xs text-red-400" role="alert">
                {snsError}
              </p>
            )}

            {contactSuggestions.length > 0 && (
              <ul id="destination-suggestions" role="listbox" aria-label="Contact suggestions" className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-1 shadow-2xl">
                {contactSuggestions.map((item, index) => (
                  <li key={item.address} role="option" aria-selected={index === activeSuggestion}>
                    <button
                      type="button"
                      onClick={() => { setDestination(item.address); setActiveSuggestion(0); }}
                      className={clsx("flex w-full flex-col items-start rounded-lg px-3 py-2 text-left", index === activeSuggestion ? "bg-white/5" : "hover:bg-white/5")}
                    >
                      <span className="text-sm font-medium text-slate-200">{item.name}</span>
                      <span className="text-xs text-slate-500">{shortenAddress(item.address, 8)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

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
            <p className="mt-2 text-xs text-slate-400" role="status">
              {feeStatus === "loading" && "Fetching current network fee…"}
              {feeStatus === "error" && `Network fee unavailable; using ${STELLAR_BASE_FEE_XLM} XLM fallback.`}
              {feeStatus === "ready" && estimatedTotalDeducted != null &&
                `Estimated fee: ~${networkFeeXlm.toFixed(7)} XLM (${Math.round(networkFeeXlm * 10_000_000)} stroops); total ~${estimatedTotalDeducted.toFixed(7)} XLM.`}
            </p>
          </div>
        )}

        {!hideMemoField && (
          <div>
            <label className="label" htmlFor="memo-type">Memo (optional)</label>
            <select
              id="memo-type"
              value={memoType}
              onChange={(e) => handleMemoTypeChange(e.target.value as StellarMemoType)}
              className="input-field mb-2"
              disabled={status !== "idle"}
              aria-label="Memo type"
            >
              <option value="text">MEMO_TEXT</option>
              <option value="id">MEMO_ID</option>
              <option value="hash">MEMO_HASH</option>
              <option value="return">MEMO_RETURN</option>
            </select>
            <input
              type={memoType === "id" ? "text" : "text"}
              inputMode={memoType === "id" ? "numeric" : "text"}
              value={memo}
              onChange={(e) => handleMemoChange(e.target.value)}
              placeholder={memoPlaceholder}
              className={clsx("input-field", memoError && "border-red-500/50")}
              disabled={status !== "idle"}
              maxLength={
                memoType === "text"
                  ? STELLAR_MEMO_TEXT_MAX_BYTES
                  : memoType === "id"
                    ? 20
                    : STELLAR_MEMO_HASH_HEX_LENGTH + 2
              }
              aria-label="Memo value"
            />
            {memoType === "text" && (
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
                        status !== "idle" && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {template}
                    </button>
                  );
                })}
              </div>
            )}
            {memoError ? (
              <p className="mt-3 text-xs text-red-400">{memoError}</p>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                {memoType === "text"
                  ? `${memoTextByteLength(memo)}/${STELLAR_MEMO_TEXT_MAX_BYTES} characters`
                  : memoType === "id"
                    ? "Unsigned 64-bit integer (uint64)"
                    : `${memo.replace(/^0x/i, "").length}/${STELLAR_MEMO_HASH_HEX_LENGTH} hex characters`}
              </p>
            )}
          </div>
        )}

        <button
          onClick={openConfirmation}
          disabled={!canSubmit || status !== "idle"}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {status === "idle"
            ? t("sendPayment.sendWithAmount", {
                amount: amount || "",
                asset: selectedAsset,
              })
            : t("sendPayment.processing")}
        </button>
      </div>
    </div>

      <SendConfirmationModal
        isOpen={isConfirmOpen}
        destination={destination}
        amount={amountNum}
        asset={selectedAsset}
        memo={memo}
        memoType={memoType}
        estimatedFee={ESTIMATED_NETWORK_FEE}
        isTipOnChain={isTipOnChain}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => { setIsConfirmOpen(false); executeSend(); }}
      />

      <ContactPickerModal
        isOpen={isContactPickerOpen}
        onSelect={(contact) => {
          setDestination(contact.address);
          setIsContactPickerOpen(false);
        }}
        onClose={() => setIsContactPickerOpen(false)}
      />

      <PaymentStatusModal
        isOpen={isStatusModalOpen}
        status={status}
        txHash={txHash}
        error={error}
        failedStep={failedStep}
        stepTimings={stepTimings}
        timeoutSeconds={60}
        onClose={closeStatusModal}
        receipt={{
          sender: publicKey,
          recipient: destination,
          amount: hasAmount ? amountNum.toFixed(7) : undefined,
          asset: selectedAsset,
          memo: memo.trim() || undefined,
        }}
      />
    </>
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

function ContactsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
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

function ReceiptIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

interface SendConfirmationModalProps {
  isOpen: boolean;
  destination: string;
  amount: number;
  asset: string;
  memo: string;
  memoType: StellarMemoType;
  estimatedFee: string;
  usdValue: number;
  isTipOnChain: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function SendConfirmationModal({ isOpen, destination, amount, memo, memoType, estimatedFee, usdValue, onCancel, onConfirm }: SendConfirmationModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 border border-white/10 shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-4">
          {t("sendPayment.confirmTitle")}
        </h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-500 uppercase font-bold">
              {t("sendPayment.to")}
            </p>
            <p className="text-sm font-mono text-slate-200 break-all">{destination}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold">
                {t("sendPayment.amount", { asset: "XLM" })}
              </p>
              <p className="text-lg font-bold text-white">{amount} XLM</p>
              <p className="text-xs text-slate-400">≈ ${usdValue.toFixed(2)} USD</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold">
                {t("sendPayment.fee")}
              </p>
              <p className="text-sm text-slate-300">{estimatedFee}</p>
            </div>
          </div>
          {memo && (
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold">Memo ({memoType.toUpperCase()})</p>
              <p className="text-sm text-slate-200 break-all">{memo}</p>
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

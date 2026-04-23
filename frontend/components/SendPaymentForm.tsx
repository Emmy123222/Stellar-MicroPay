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
  isValidStellarAddress,
  server,
  submitTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatXLM } from "@/utils/format";
import clsx from "clsx";
import { useEffect, useState } from "react";

interface SendPaymentFormProps {
  publicKey: string;
  xlmBalance: string;
  usdcBalance?: string | null;
  onSuccess?: () => void;
  prefill?: {
    destination: string;
    amount: string;
    memo?: string;
    validUntil?: number;
  } | null;
}

type Status = PaymentFlowStatus;
type AssetType = "XLM" | "USDC";

const ESTIMATED_NETWORK_FEE = "0.00001 XLM";

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
}: SendPaymentFormProps) {
  const [selectedAsset, setSelectedAsset] = useState<AssetType>("XLM");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
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
  const isValidDest = destination.length > 0 && isValidStellarAddress(destination);
  const MIN_STROOP = 0.0000001;
  const isValidAmt =
    !Number.isNaN(amountNum) && amountNum >= MIN_STROOP && amountNum <= maxSend;
  const canSubmit =
    isValidDest && isValidAmt && status === "idle" && destination !== publicKey;

  const resetTracker = () => {
    setStatus("idle");
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

  return (
    <>
      <div className="card animate-fade-in">
        <h2 className="mb-6 flex items-center gap-2 font-display text-lg font-semibold text-white">
          <SendIcon className="h-5 w-5 text-stellar-400" />
          {`Send Payment`}
        </h2>

        <div className="space-y-5">
          <div className="flex gap-2">
            {(["XLM", "USDC"] as AssetType[]).map((asset) => (
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
          </div>

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

          {CONTRACT_ID && (
            <div className="flex items-start gap-3 rounded-xl border border-stellar-500/10 bg-stellar-500/5 p-3 transition-colors hover:bg-stellar-500/8">
              <div className="flex h-5 items-center">
                <input
                  id="tip-on-chain"
                  type="checkbox"
                  checked={isTipOnChain}
                  onChange={(e) => setIsTipOnChain(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-stellar-500 focus:ring-stellar-500/20"
                  disabled={status !== "idle"}
                />
              </div>
              <div className="flex flex-col">
                <label
                  htmlFor="tip-on-chain"
                  className="cursor-pointer text-sm font-medium text-slate-200"
                >
                  {`Record as tip on-chain`}
                </label>
                <p className="mt-0.5 text-xs text-slate-500">
                  {`This payment will be permanently recorded as a tip on the Soroban smart contract.`}
                </p>
              </div>
            </div>
          )}

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

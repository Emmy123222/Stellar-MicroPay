"use client";

import { useEffect, useMemo, useState } from "react";

export type PaymentStepId = "building" | "signing" | "submitting" | "confirming";
export type PaymentFlowStatus =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

const TX_TIMEOUT_SECONDS = 60;

export interface PaymentStepTiming {
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
}

/**
 * Details rendered on the printed receipt (Issue #1045). All fields are
 * optional — unknown values print as an em dash so a receipt is always
 * producible from whatever the caller knows.
 */
export interface PaymentReceiptDetails {
  sender?: string;
  recipient?: string;
  amount?: string;
  asset?: string;
  memo?: string;
  /** Completion timestamp (ms epoch or ISO string) shown as date/time. */
  completedAt?: number | string;
}

interface PaymentStatusModalProps {
  isOpen: boolean;
  status: PaymentFlowStatus;
  txHash: string | null;
  error: string | null;
  failedStep: PaymentStepId | null;
  stepTimings: Record<PaymentStepId, PaymentStepTiming>;
  onClose: () => void;
  explorerHref?: string | null;
  timeoutSeconds?: number;
  /** Payment details for the printable receipt (success state). */
  receipt?: PaymentReceiptDetails | null;
}

const STEP_ORDER: Array<{ id: PaymentStepId; label: string }> = [
  { id: "building", label: "Building" },
  { id: "signing", label: "Signing" },
  { id: "submitting", label: "Submitting" },
  { id: "confirming", label: "Confirming" },
];

export default function PaymentStatusModal({
  isOpen,
  status,
  txHash,
  error,
  failedStep,
  stepTimings,
  onClose,
  explorerHref,
  timeoutSeconds = TX_TIMEOUT_SECONDS,
  receipt,
}: PaymentStatusModalProps) {
  const [now, setNow] = useState(() => Date.now());

  const isTerminal = status === "success" || status === "error";

  useEffect(() => {
    if (!isOpen) return;

    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isTerminal) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isTerminal, onClose]);

  const progress = useMemo(() => {
    const completedCount = STEP_ORDER.filter(
      ({ id }) => stepTimings[id].completedAt !== null
    ).length;

    if (status === "success") return 100;
    if (status === "error") {
      return Math.max(12, (completedCount / STEP_ORDER.length) * 100);
    }

    return Math.min(
      95,
      ((completedCount + (status !== "idle" ? 0.5 : 0)) / STEP_ORDER.length) * 100
    );
  }, [status, stepTimings]);

  if (!isOpen) return null;

  // Issue #1045 — print receipt: mark the body so the print stylesheet
  // hides everything except the receipt block, then invoke the browser
  // print dialog once the styles have painted (double rAF). `window.print`
  // blocks until the dialog closes, so the class is also removed
  // synchronously afterwards as a belt-and-braces cleanup.
  const handlePrintReceipt = () => {
    document.body.classList.add("receipt-modal-printing");
    const cleanup = () => {
      document.body.classList.remove("receipt-modal-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        cleanup();
      });
    });
  };

  const receiptDate = receipt?.completedAt
    ? new Date(receipt.completedAt)
    : new Date();
  const receiptAmount = receipt?.amount
    ? `${parseFloat(receipt.amount).toFixed(7)} ${receipt.asset ?? "XLM"}`
    : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-status-title"
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900/95 shadow-2xl"
      >
        <div className="border-b border-white/10 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stellar-300/80">
                Payment Tracker
              </p>
              <h3
                id="payment-status-title"
                className="mt-2 font-display text-xl font-semibold text-white"
              >
                {status === "success"
                  ? "Complete"
                  : status === "error"
                    ? "Payment failed"
                    : "Processing payment"}
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                {status === "success"
                  ? "Your transaction has been confirmed on the Stellar network."
                  : status === "error"
                    ? "The transaction stopped before completion."
                    : "Stay on this screen while we move through each network step."}
              </p>
            </div>

            {isTerminal && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Close
              </button>
            )}
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-stellar-500 via-cyan-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {!isTerminal && (
            <CountdownTimer
              startedAt={stepTimings.building.startedAt}
              timeoutSeconds={timeoutSeconds}
              now={now}
            />
          )}
        </div>

        <div className="space-y-4 px-6 py-5">
          {STEP_ORDER.map(({ id, label }, index) => {
            const timing = stepTimings[id];
            const stepState = getStepState({
              id,
              status,
              failedStep,
              timing,
            });

            return (
              <div key={id} className="relative">
                {index < STEP_ORDER.length - 1 && (
                  <div className="absolute left-[1.1rem] top-11 h-[calc(100%-1.25rem)] w-px bg-white/10" />
                )}

                <div className="flex items-start gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-950/60 text-slate-200">
                    <StepIcon id={id} state={stepState} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{label}</p>
                        <p className="text-xs text-slate-400">
                          {getStepCaption(stepState)}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-slate-400">
                        {formatElapsed(timing, now)}
                      </span>
                    </div>

                    {stepState === "failed" && timing.error && (
                      <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                        {timing.error}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {status === "success" && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <p className="font-medium">Transaction confirmed</p>
              {txHash && <p className="mt-1 break-all text-emerald-100/90">{txHash}</p>}
              {explorerHref && txHash && (
                <a
                  href={explorerHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-emerald-100 transition-colors hover:text-white"
                >
                  View on Stellar Expert
                  <ExternalLinkIcon className="h-4 w-4" />
                </a>
              )}

              {/* Issue #1045 — paper/PDF receipt from the success state */}
              <button
                type="button"
                onClick={handlePrintReceipt}
                data-testid="print-receipt-button"
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 px-3 py-1.5 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-400/10 hover:text-white print:hidden"
              >
                <PrinterIcon className="h-4 w-4" />
                Print receipt
              </button>
            </div>
          )}

          {status === "error" && error && !stepTimings[failedStep ?? "building"].error && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Printable receipt (Issue #1045) — hidden on screen, shown by the
            print stylesheet while body has .receipt-modal-printing. */}
        {status === "success" && (
          <div className="receipt-modal-sheet hidden" data-testid="payment-receipt-sheet">
            <p className="receipt-brand">Stellar MicroPay</p>
            <h4 className="receipt-title">Payment Receipt</h4>
            <dl className="receipt-grid">
              <div>
                <dt>Date / time</dt>
                <dd>{receiptDate.toLocaleString()}</dd>
              </div>
              {receipt?.sender && (
                <div>
                  <dt>From</dt>
                  <dd className="receipt-mono">{receipt.sender}</dd>
                </div>
              )}
              {receipt?.recipient && (
                <div>
                  <dt>To</dt>
                  <dd className="receipt-mono">{receipt.recipient}</dd>
                </div>
              )}
              {receiptAmount && (
                <div>
                  <dt>Amount</dt>
                  <dd>{receiptAmount}</dd>
                </div>
              )}
              {receipt?.memo && (
                <div>
                  <dt>Memo</dt>
                  <dd>{receipt.memo}</dd>
                </div>
              )}
              {txHash && (
                <div>
                  <dt>Transaction hash</dt>
                  <dd className="receipt-mono break-all">{txHash}</dd>
                </div>
              )}
              {explorerHref && txHash && (
                <div>
                  <dt>Explorer</dt>
                  <dd className="receipt-mono break-all">{explorerHref}</dd>
                </div>
              )}
            </dl>
            <p className="receipt-footer">
              Generated by Stellar MicroPay — printed {new Date().toLocaleString()}.
            </p>
          </div>
        )}

        <style jsx global>{`
          @media print {
            /* Receipt print mode: hide everything, show only the sheet. */
            body.receipt-modal-printing * {
              visibility: hidden !important;
            }

            body.receipt-modal-printing .receipt-modal-sheet,
            body.receipt-modal-printing .receipt-modal-sheet * {
              visibility: visible !important;
            }

            body.receipt-modal-printing .receipt-modal-sheet {
              display: block !important;
              position: fixed !important;
              inset: 0 !important;
              width: 210mm;
              min-height: 297mm;
              margin: 0 auto !important;
              padding: 18mm 16mm !important;
              background: #fff !important;
              color: #0f172a !important;
              border: none !important;
              border-radius: 0 !important;
              box-shadow: none !important;
            }

            body.receipt-modal-printing .receipt-modal-sheet * {
              color: inherit !important;
            }

            .receipt-modal-sheet .receipt-brand {
              font-size: 11px;
              letter-spacing: 0.24em;
              text-transform: uppercase;
              color: #64748b;
              margin-bottom: 4px;
            }

            .receipt-modal-sheet .receipt-title {
              font-size: 22px;
              font-weight: 600;
              margin-bottom: 18px;
            }

            .receipt-modal-sheet .receipt-grid {
              display: grid;
              gap: 10px;
              font-size: 13px;
            }

            .receipt-modal-sheet dt {
              font-size: 10px;
              letter-spacing: 0.18em;
              text-transform: uppercase;
              color: #64748b;
              margin-bottom: 2px;
            }

            .receipt-modal-sheet dd {
              color: #0f172a;
            }

            .receipt-modal-sheet .receipt-mono {
              font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
              word-break: break-all;
            }

            .receipt-modal-sheet .receipt-footer {
              margin-top: 24px;
              padding-top: 10px;
              border-top: 1px solid #e2e8f0;
              font-size: 11px;
              color: #64748b;
            }

            @page {
              size: A4;
              margin: 0;
            }
          }
        `}</style>
      </div>
    </div>
  );
}

function getStepState({
  id,
  status,
  failedStep,
  timing,
}: {
  id: PaymentStepId;
  status: PaymentFlowStatus;
  failedStep: PaymentStepId | null;
  timing: PaymentStepTiming;
}): "pending" | "current" | "complete" | "failed" {
  if (failedStep === id || timing.error) return "failed";
  if (timing.completedAt) return "complete";
  if (status === id) return "current";
  if (status === "success" && timing.startedAt) return "complete";
  return "pending";
}

function getStepCaption(state: "pending" | "current" | "complete" | "failed") {
  if (state === "complete") return "Completed";
  if (state === "current") return "In progress";
  if (state === "failed") return "Failed";
  return "Waiting";
}

function formatElapsed(timing: PaymentStepTiming, now: number) {
  if (!timing.startedAt) return "Waiting";

  const end = timing.completedAt ?? now;
  const elapsedMs = Math.max(0, end - timing.startedAt);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

function CountdownTimer({
  startedAt,
  timeoutSeconds,
  now,
}: {
  startedAt: number | null;
  timeoutSeconds: number;
  now: number;
}) {
  if (!startedAt) return null;

  const elapsedMs = now - startedAt;
  const remainingMs = Math.max(0, timeoutSeconds * 1000 - elapsedMs);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const fraction = remainingMs / (timeoutSeconds * 1000);

  const isUrgent = remainingSeconds <= 10;
  const isWarning = remainingSeconds <= 20;

  if (remainingSeconds <= 0) return null;

  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            isUrgent
              ? "bg-red-500"
              : isWarning
                ? "bg-amber-400"
                : "bg-stellar-400"
          }`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span
        className={`text-xs font-medium whitespace-nowrap tabular-nums ${
          isUrgent
            ? "text-red-400"
            : isWarning
              ? "text-amber-300"
              : "text-slate-400"
        }`}
      >
        {isUrgent ? `${remainingSeconds}s left` : `~${remainingSeconds}s remaining`}
      </span>
    </div>
  );
}

function StepIcon({
  id,
  state,
}: {
  id: PaymentStepId;
  state: "pending" | "current" | "complete" | "failed";
}) {
  if (state === "complete") {
    return <CheckIcon className="h-5 w-5 text-emerald-400" />;
  }

  if (state === "current") {
    return <Spinner className="h-4 w-4 text-stellar-300" />;
  }

  if (state === "failed") {
    return <XIcon className="h-5 w-5 text-red-400" />;
  }

  if (id === "building") return <BuildIcon className="h-4 w-4 text-slate-300" />;
  if (id === "signing") return <SignatureIcon className="h-4 w-4 text-slate-300" />;
  if (id === "submitting") return <UploadIcon className="h-4 w-4 text-slate-300" />;
  return <SparklesIcon className="h-4 w-4 text-slate-300" />;
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`${className ?? ""} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
    </svg>
  );
}

function BuildIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.25 6 3.75-3.75 3.75 3.75L18 9.75" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 7.5 6 15m0 0L3.75 17.25 6.75 20.25 9 18m-3-3 3 3" />
    </svg>
  );
}

function SignatureIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 16.5c2.25-2.5 3.75-3.75 5.25-3.75 1.75 0 1.75 2.25 3.25 2.25 1.75 0 2.25-6 4.75-6 1.5 0 2 1 3 2.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 20.25h18" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V4.5m0 0 4.5 4.5M12 4.5 7.5 9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75v1.5A2.25 2.25 0 0 0 6.75 19.5h10.5A2.25 2.25 0 0 0 19.5 17.25v-1.5" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75 13.688 8.313 18.25 10l-4.563 1.688L12 16.25l-1.688-4.563L5.75 10l4.563-1.688L12 3.75Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m18.75 15 .563 1.688L21 17.25l-1.688.563L18.75 19.5l-.563-1.688L16.5 17.25l1.688-.563L18.75 15Z" />
    </svg>
  );
}

function PrinterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 9V3.75A1.75 1.75 0 018.5 2h7a1.75 1.75 0 011.75 1.75V9M7.5 18.75h9M5.25 9H18.75A2.25 2.25 0 0121 11.25v5.25a1.5 1.5 0 01-1.5 1.5h-2.25V15H6.75v3H4.5A1.5 1.5 0 013 16.5v-5.25A2.25 2.25 0 015.25 9z" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

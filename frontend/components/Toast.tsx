/**
 * components/Toast.tsx
 * Global toast notification system — top-right slide-in, stacking, auto-dismiss.
 */

import { useEffect, useState } from "react";
import clsx from "clsx";
import { CheckIcon, AlertCircleIcon } from "@/components/icons";
import { useToastContext, type ToastItem } from "@/lib/ToastContext";

// ─── Individual toast item ────────────────────────────────────────────────────

export interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  onClose?: () => void;
  onRetry?: () => void;
  duration?: number;
}

export default function Toast({
  message,
  type = "info",
  onClose,
  onRetry,
  duration = 4000,
}: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      if (onClose) setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={clsx(
        "flex items-start gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white",
        "border shadow-xl transition-all duration-300",
        visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4",
        type === "success" && "bg-emerald-600 border-emerald-500",
        type === "error" && "bg-red-600 border-red-500",
        type === "info" && "bg-slate-800 border-white/10"
      )}
    >
      <div className="flex-shrink-0 mt-0.5">
        {type === "success" && <CheckIcon className="w-4 h-4" />}
        {type === "error" && <AlertCircleIcon className="w-4 h-4" />}
      </div>

      <span className="flex-1 leading-snug">{message}</span>

      <div className="flex items-center gap-2 flex-shrink-0">
        {type === "error" && onRetry && (
          <button
            onClick={() => {
              onClose?.();
              onRetry();
            }}
            className="text-xs font-semibold underline hover:no-underline"
          >
            Retry
          </button>
        )}
        <button
          onClick={() => { setVisible(false); setTimeout(() => onClose?.(), 300); }}
          className="text-white/60 hover:text-white transition-colors"
          aria-label="Dismiss notification"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Global stacked container (rendered once in _app.tsx) ─────────────────────

function ToastItemWrapper({ toast }: { toast: ToastItem }) {
  const { removeToast } = useToastContext();
  return (
    <Toast
      message={toast.message}
      type={toast.type}
      onClose={() => removeToast(toast.id)}
      onRetry={toast.onRetry}
      duration={toast.duration}
    />
  );
}

export function ToastContainer() {
  const { toasts } = useToastContext();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto animate-slide-up">
          <ToastItemWrapper toast={t} />
        </div>
      ))}
    </div>
  );
}

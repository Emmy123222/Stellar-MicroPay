/**
 * components/Toast.tsx
 * Lightweight toast notification with auto-dismiss and fade-out.
 */

import { useEffect, useState } from "react";
import clsx from "clsx";
import { CheckIcon, AlertCircleIcon } from "@/components/icons";

export interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  onClose?: () => void;
  duration?: number;
}

export default function Toast({ message, type = "info", onClose, duration = 3000 }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      if (onClose) {
        setTimeout(onClose, 300); // Wait for fade out
      }
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "px-4 py-2.5 rounded-xl text-sm font-medium text-white",
        "border shadow-xl transition-all duration-300",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        type === "success" && "bg-emerald-600 border-emerald-500",
        type === "error" && "bg-red-600 border-red-500",
        type === "info" && "bg-slate-800 border-white/10"
      )}
    >
      <div className="flex items-center gap-2">
        {type === "success" && (
          <CheckIcon className="w-4 h-4" />
        )}
        {type === "error" && (
          <AlertCircleIcon className="w-4 h-4" />
        )}
        {message}
      </div>
    </div>
  );
}

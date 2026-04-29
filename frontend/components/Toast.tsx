/**
 * components/Toast.tsx
 * Lightweight toast notification with auto-dismiss and fade-out.
 */

import { useEffect, useState } from "react";
import clsx from "clsx";

interface ToastProps {
  message: string;
  visible?: boolean;
  type?: "success" | "error" | "info";
  onClose?: () => void;
}

export default function Toast({ message, visible, type = "info", onClose }: ToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible || message) {
      setShow(true);
    }
    
    if (onClose && message) {
      const t = setTimeout(() => {
        setShow(false);
        onClose();
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [visible, message, onClose]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-xl",
        "transition-opacity duration-300",
        type === "success" ? "bg-emerald-600 border border-emerald-500" :
        type === "error" ? "bg-rose-600 border border-rose-500" :
        "bg-cosmos-800 border border-white/10",
        show ? "opacity-100" : "opacity-0"
      )}
    >
      {message}
    </div>
  );
}

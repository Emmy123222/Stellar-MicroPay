/**
 * components/Toast.tsx
 * Lightweight toast notification with auto-dismiss and fade-out.
 */

import { useEffect, useState } from "react";
import clsx from "clsx";

interface ToastProps {
  message: string;
  visible: boolean;
}

export default function Toast({ message, visible }: ToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setShow(true);
    } else {
      // slight delay so fade-out plays before unmounting
      const t = setTimeout(() => setShow(false), 300);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "px-4 py-2.5 rounded-xl text-sm font-medium text-white",
        "bg-cosmos-800 border border-white/10 shadow-xl",
        "transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      {message}
    </div>
  );
}

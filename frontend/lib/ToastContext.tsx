/**
 * lib/ToastContext.tsx
 * Global toast context for stacked, auto-dismissing notifications.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ToastItem {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  onRetry?: () => void;
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (
    message: string,
    type?: ToastItem["type"],
    onRetry?: () => void,
    duration?: number
  ) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let _counter = 0;

/** Provides the toast context, managing the stacked toast list and auto-dismiss timers for descendants. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clean up every outstanding auto-dismiss timer when the provider unmounts,
  // so no consumer is left holding a timer for a toast that no longer exists.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (
      message: string,
      type: ToastItem["type"] = "info",
      onRetry?: () => void,
      duration = 4000
    ) => {
      const id = `toast-${++_counter}`;
      setToasts((prev) => [...prev, { id, message, type, onRetry, duration }]);

      const timer = setTimeout(() => removeToast(id), duration);
      timersRef.current.set(id, timer);
    },
    [removeToast]
  );

  // One provider-owned value. Consumers that read via useToastContext share
  // this single source of truth; memoising keeps the reference stable across
  // renders where the toast list has not changed.
  const value = useMemo(
    () => ({ toasts, addToast, removeToast }),
    [toasts, addToast, removeToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

const NOOP_CTX: ToastContextValue = {
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
};

/** Access the toast context, falling back to a no-op implementation when used outside a ToastProvider. */
export function useToastContext(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP_CTX;
}

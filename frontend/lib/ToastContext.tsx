/**
 * lib/ToastContext.tsx
 * Global toast context for stacked, auto-dismissing notifications.
 */

import {
  createContext,
  useCallback,
  useContext,
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

const NOOP_CTX: ToastContextValue = {
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
};

export function useToastContext(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP_CTX;
}

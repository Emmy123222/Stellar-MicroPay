/**
 * lib/useToast.ts
 * Backward-compatible wrapper around the global ToastContext.
 * Existing callers of useToast() continue to work with showToast(msg).
 */

import { useToastContext } from "@/lib/ToastContext";

/** React hook returning toast helpers backed by the global ToastContext. */
export function useToast() {
  const { addToast, removeToast } = useToastContext();

  const show = (msg: string, type: "success" | "error" | "info" = "info") => {
    addToast(msg, type);
  };

  const dismiss = (id: string) => {
    removeToast(id);
  };

  const showToast = (
    msg: string,
    type: "success" | "error" | "info" = "info",
  ) => {
    show(msg, type);
  };

  const dismissToast = (id: string) => {
    dismiss(id);
  };

  return { show, dismiss, showToast, dismissToast };
}

/**
 * lib/useToast.ts
 * Backward-compatible wrapper around the global ToastContext.
 * Existing callers of useToast() continue to work with showToast(msg).
 */

import { useToastContext } from "@/lib/ToastContext";

export function useToast() {
  const { addToast } = useToastContext();

  const showToast = (msg: string, type: "success" | "error" | "info" = "info") => {
    addToast(msg, type);
  };

  return { showToast };
}

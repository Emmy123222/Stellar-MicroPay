/**
 * lib/useToast.ts
 * Hook for managing toast visibility with auto-dismiss.
 */

import { useState, useCallback, useRef } from "react";

export function useToast(duration = 2000) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (msg: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setMessage(msg);
      setVisible(true);
      timerRef.current = setTimeout(() => setVisible(false), duration);
    },
    [duration]
  );

  return { visible, message, showToast };
}

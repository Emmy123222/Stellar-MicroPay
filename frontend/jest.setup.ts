import { TextDecoder, TextEncoder } from "util";

declare global {
  function primeRealtimeCursor(): void;
  function handleRealtimePayment(callback: (payment: unknown) => void): () => void;
  function startPollingFallback(): void;
  function stopPollingFallback(): void;
}

Object.assign(global, {
  TextEncoder,
  TextDecoder,
  primeRealtimeCursor: () => {},
  handleRealtimePayment: () => () => {},
  startPollingFallback: () => {},
  stopPollingFallback: () => {},
});
});

// Mock @/lib/i18n so all components that use useTranslation() render in tests
jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) return `${key}:${JSON.stringify(opts)}`;
      return key;
    },
  }),
}));

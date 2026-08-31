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
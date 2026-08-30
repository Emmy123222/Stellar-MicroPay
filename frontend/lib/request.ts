/**
 * @file lib/request.ts
 * @description AbortController-based timeouts and consistent error
 * classification for browser fetch calls. Lets callers distinguish a request
 * that timed out from one that failed while offline or over HTTP, and lets
 * components cancel in-flight requests on unmount.
 */

/** Thrown when a fetch exceeds its operation-specific budget. */
export class RequestTimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

/**
 * Thrown when the browser has no network connectivity. Extends `TypeError`
 * because browsers reject offline fetches with `TypeError("Failed to fetch")`;
 * callers that branch on `instanceof TypeError` keep working.
 */
export class OfflineError extends TypeError {
  constructor(message = "You appear to be offline") {
    super(message);
    this.name = "OfflineError";
  }
}

/** A request that was intentionally cancelled (e.g. component unmounted). */
export class RequestAbortedError extends Error {
  constructor(message = "Request aborted") {
    super(message);
    this.name = "RequestAbortedError";
  }
}

export interface TimeoutHandle {
  controller: AbortController;
  cleanup: () => void;
  /**
   * Returns true when the abort was caused by the timeout budget elapsing
   * (as opposed to a caller-supplied signal). Must be queried after the
   * request settles.
   */
  wasTimeout: () => boolean;
}

/**
 * Create an AbortController that aborts when either a caller-supplied signal
 * is aborted or the given timeout budget (in ms) elapses, whichever comes
 * first. The returned `controller.signal` should be passed to fetch.
 *
 * Call `cleanup` once the request settles so the timer and external-signal
 * listener are released.
 */
export function createTimeoutController(
  timeoutMs: number,
  externalSignal?: AbortSignal | null,
): TimeoutHandle {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else if (typeof externalSignal.addEventListener === "function") {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  if (timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (externalSignal && typeof externalSignal.removeEventListener === "function") {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  };

  return { controller, cleanup, wasTimeout: () => timedOut };
}

/**
 * Classify an error rejected by fetch into one of the concrete error types
 * ({@link RequestTimeoutError}, {@link RequestAbortedError}, or
 * {@link OfflineError}) so callers can react to each distinctly.
 *
 * HTTP status errors should be handled by the caller via `res.ok` and are
 * intentionally left untouched here.
 *
 * @param err - The error rejected by fetch.
 * @param aborted - Whether the associated AbortController fired.
 * @param timedOut - Whether the abort was caused by the timeout budget.
 */
export function classifyFetchError(
  err: unknown,
  aborted = false,
  timedOut = false,
): Error {
  if (aborted) {
    return timedOut ? new RequestTimeoutError() : new RequestAbortedError();
  }

  // Browsers reject with a TypeError("Failed to fetch") when offline.
  if (err instanceof TypeError) {
    return new OfflineError();
  }

  return err instanceof Error ? err : new Error(String(err));
}

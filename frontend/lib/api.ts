/**
 * @file lib/api.ts
 * @description Shared fetch wrapper with consistent error handling for API calls.
 */

import { createTimeoutController, classifyFetchError } from "./request";

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
}

/** Default budget for a single backend API request. */
export const API_TIMEOUT_MS = 10_000;

/** Longer budget for bulk/heavy endpoints (e.g. CSV import, history exports). */
export const API_BULK_TIMEOUT_MS = 30_000;

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorResponse {
  success?: false;
  error: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fetch JSON from the backend API with consistent error handling.
 *
 * By default expects the standard `{ success: true, data: T }` envelope.
 * Pass `raw: true` to skip envelope parsing and return the full JSON body.
 *
 * Requests are automatically aborted after `timeoutMs` (default
 * {@link API_TIMEOUT_MS}). Pass an external `signal` to cancel the request on
 * component unmount. Timeout, offline, and abort conditions are surfaced as
 * {@link RequestTimeoutError}, {@link OfflineError}, and
 * {@link RequestAbortedError} respectively.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { raw?: boolean },
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<T> {
  const { raw, signal: externalSignal, ...fetchInit } = init ?? {};
  const url = path.startsWith("http") ? path : `${apiBase()}${path}`;

  const { controller, cleanup, wasTimeout } = createTimeoutController(timeoutMs, externalSignal);

  let res: Response;
  try {
    res = await fetch(url, {
      ...fetchInit,
      headers: {
        "Content-Type": "application/json",
        ...fetchInit.headers,
      },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    cleanup();
    throw classifyFetchError(err, controller.signal.aborted, wasTimeout());
  }

  cleanup();
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (json as ApiErrorResponse | null)?.error ||
      `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, json);
  }

  if (raw) {
    return json as T;
  }

  const envelope = json as ApiSuccessResponse<T> | ApiErrorResponse | null;
  if (envelope && "error" in envelope) {
    throw new ApiError(
      envelope.error ?? "Request failed",
      res.status,
      json,
    );
  }

  return (envelope && "data" in envelope ? (envelope as ApiSuccessResponse<T>).data : json) as T;
}

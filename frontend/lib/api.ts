/**
 * @file lib/api.ts
 * @description Shared fetch wrapper with consistent error handling for API calls.
 */

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
}

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
    public body?: unknown
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
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { raw?: boolean }
): Promise<T> {
  const { raw, ...fetchInit } = init ?? {};
  const url = path.startsWith("http") ? path : `${apiBase()}${path}`;

  const res = await fetch(url, {
    ...fetchInit,
    headers: {
      "Content-Type": "application/json",
      ...fetchInit.headers,
    },
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (json as ApiErrorResponse | null)?.error || `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, json);
  }

  if (raw) {
    return json as T;
  }

  const envelope = json as ApiSuccessResponse<T> | ApiErrorResponse | null;
  if (envelope && "error" in envelope) {
    throw new ApiError(envelope.error ?? "Request failed", res.status, json);
  }

  return (envelope && "data" in envelope ? (envelope as ApiSuccessResponse<T>).data : json) as T;
}

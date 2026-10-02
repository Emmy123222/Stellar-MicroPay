/**
 * lib/paymentApi.ts
 * Client helpers for the payment endpoints that require a signed request.
 */

import { buildSignedHeaders } from "./requestSignature";

export interface PaymentSubmission {
  senderPublicKey: string;
  recipientPublicKey: string;
  amount: string;
  asset?: string;
  txHash?: string;
}

function apiBase() {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
}

/**
 * Record a payment the client has already signed and broadcast to Horizon.
 *
 * The body is serialised once and that exact string is both signed and sent —
 * the server verifies the signature over the raw bytes it receives, so signing
 * a re-serialised copy would risk a mismatch and an opaque 401.
 */
export async function submitSignedPayment(
  submission: PaymentSubmission,
  options: { path?: string; timestamp?: number } = {}
) {
  const path = options.path ?? "/api/payments/submit";
  const body = JSON.stringify(submission);

  const headers = await buildSignedHeaders({
    method: "POST",
    path,
    body,
    timestamp: options.timestamp,
  });

  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers,
    body,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const error = new Error(json?.error || "Payment submission failed") as Error & {
      code?: string;
    };
    if (json?.code) error.code = json.code;
    throw error;
  }

  return json.data;
}

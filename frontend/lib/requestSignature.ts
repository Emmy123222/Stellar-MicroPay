/**
 * lib/requestSignature.ts
 * Client half of the X-Timestamp / X-Signature replay protection scheme.
 *
 * Must stay byte-compatible with backend/src/utils/requestSignature.js — the
 * canonical string layout is part of the wire contract:
 *
 *     <timestamp>.<METHOD>.<path>.<sha256hex(body)>
 *
 * Implementation uses Web Crypto, which is the only option in a static
 * Next.js export — there is no server runtime to fall back on, and the build
 * must not pull in Node's `crypto`.
 *
 * Security note, stated plainly: the shared secret ships in the browser bundle
 * and is therefore readable by anyone who loads the page. This scheme prevents
 * replay and in-transit modification by an attacker who can observe traffic but
 * cannot read the bundle; it is not an authorisation mechanism. The stronger
 * design is a per-user secret fetched after sign-in, the model the webhook
 * endpoints already use.
 */

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Web Crypto is only exposed in secure contexts (https, or localhost). Failing
 * loudly beats silently sending an unsigned request that the server will
 * reject with an opaque 401.
 */
function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "Web Crypto is unavailable. Request signing requires a secure context (https or localhost)."
    );
  }
  return subtle;
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await getSubtle().digest("SHA-256", encoder.encode(data)));
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const subtle = getSubtle();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await subtle.sign("HMAC", key, encoder.encode(data)));
}

/**
 * Assemble the string that gets signed.
 *
 * The body hash is what stops a captured signature being reused against a
 * different payload: without it, only the timestamp is bound, and the amount
 * could be edited in flight.
 */
export async function buildCanonicalString(parts: {
  timestamp: string | number;
  method: string;
  path: string;
  body?: string;
}): Promise<string> {
  const { timestamp, method, path, body = "" } = parts;
  const digest = await sha256Hex(body);
  return `${timestamp}.${method.toUpperCase()}.${path}.${digest}`;
}

/**
 * Produce the X-Signature value for a request.
 */
export async function signRequest(
  parts: { timestamp: string | number; method: string; path: string; body?: string },
  secret: string
): Promise<string> {
  if (!secret) {
    throw new Error("A non-empty request signing secret is required");
  }
  const canonical = await buildCanonicalString(parts);
  return hmacSha256Hex(secret, canonical);
}

/**
 * Build the full header set for a signed request.
 *
 * @param body exact string that will be sent as the request body — the server
 *             verifies over the raw bytes it receives, so re-serialising here
 *             could produce a different string and a mismatched signature.
 */
export async function buildSignedHeaders(options: {
  method: string;
  path: string;
  body: string;
  secret?: string;
  timestamp?: number;
}): Promise<Record<string, string>> {
  const { method, path, body, timestamp = Date.now(), secret } = options;
  const signature = await signRequest({ timestamp, method, path, body }, secret ?? getSigningSecret());
  return {
    "Content-Type": "application/json",
    "X-Timestamp": String(timestamp),
    "X-Signature": signature,
  };
}

/**
 * Shared signing secret.
 *
 * Matches the backend's PAYMENT_SIGNING_SECRET. Next.js inlines
 * NEXT_PUBLIC_* variables at build time, so both sides must be configured to
 * the same value for signed requests to verify.
 */
export function getSigningSecret(): string {
  return process.env.NEXT_PUBLIC_PAYMENT_SIGNING_SECRET || "";
}

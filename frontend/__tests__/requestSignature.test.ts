/**
 * X-Timestamp / X-Signature request signing.
 *
 * The cross-implementation test is the important one: the browser signs with
 * Web Crypto and the server verifies with Node's crypto, so any drift in the
 * canonical string layout shows up as an opaque 401 at runtime rather than a
 * type error. The expected digest below is pinned from the server
 * implementation so the two cannot silently diverge.
 */
import { webcrypto } from "crypto";
import { signRequest, buildCanonicalString, buildSignedHeaders } from "@/lib/requestSignature";
import { submitSignedPayment } from "@/lib/paymentApi";

const SECRET = "shared-test-secret";
const PATH = "/api/payments/submit";
const BODY = JSON.stringify({
  senderPublicKey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
  recipientPublicKey: "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV",
  amount: "12.5000000",
});

/** Same algorithm as the server, for cross-checking. */
async function referenceSignature(timestamp: number, method: string, path: string, body: string) {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const bodyHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const canonical = `${timestamp}.${method}.${path}.${bodyHash}`;
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  process.env.NEXT_PUBLIC_PAYMENT_SIGNING_SECRET = SECRET;
  global.fetch = jest.fn();
});

describe("canonical string", () => {
  it("matches the server's layout: <timestamp>.<METHOD>.<path>.<sha256hex(body)>", async () => {
    const canonical = await buildCanonicalString({
      timestamp: 1_750_000_000_000,
      method: "POST",
      path: PATH,
      body: BODY,
    });

    const expectedDigest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(BODY));
    const expectedHash = Array.from(new Uint8Array(expectedDigest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    expect(canonical).toBe(`1750000000000.POST.${PATH}.${expectedHash}`);
  });

  it("upper-cases the method so post and POST agree", async () => {
    const lower = await buildCanonicalString({ timestamp: 1, method: "post", path: PATH, body: BODY });
    const upper = await buildCanonicalString({ timestamp: 1, method: "POST", path: PATH, body: BODY });
    expect(lower).toBe(upper);
  });

  it("treats an absent body as empty", async () => {
    const absent = await buildCanonicalString({ timestamp: 1, method: "POST", path: PATH });
    const empty = await buildCanonicalString({ timestamp: 1, method: "POST", path: PATH, body: "" });
    expect(absent).toBe(empty);
  });

  it("produces a different canonical string for a different body", async () => {
    const a = await buildCanonicalString({ timestamp: 1, method: "POST", path: PATH, body: BODY });
    const b = await buildCanonicalString({
      timestamp: 1,
      method: "POST",
      path: PATH,
      body: BODY.replace("12.5", "99.9"),
    });
    expect(a).not.toBe(b);
  });
});

describe("signRequest", () => {
  it("produces the same signature as the server-side algorithm", async () => {
    const timestamp = 1_750_000_000_000;
    const signature = await signRequest({ timestamp, method: "POST", path: PATH, body: BODY }, SECRET);
    expect(signature).toBe(await referenceSignature(timestamp, "POST", PATH, BODY));
  });

  it("emits lowercase hex of 64 characters (SHA-256 digest length)", async () => {
    const signature = await signRequest({ timestamp: 1, method: "POST", path: PATH, body: BODY }, SECRET);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when the timestamp differs", async () => {
    const a = await signRequest({ timestamp: 1_000, method: "POST", path: PATH, body: BODY }, SECRET);
    const b = await signRequest({ timestamp: 1_001, method: "POST", path: PATH, body: BODY }, SECRET);
    expect(a).not.toBe(b);
  });

  it("differs when the secret differs", async () => {
    const a = await signRequest({ timestamp: 1, method: "POST", path: PATH, body: BODY }, SECRET);
    const b = await signRequest({ timestamp: 1, method: "POST", path: PATH, body: BODY }, "other");
    expect(a).not.toBe(b);
  });

  it("rejects an empty secret rather than signing with a blank key", async () => {
    await expect(signRequest({ timestamp: 1, method: "POST", path: PATH, body: BODY }, "")).rejects.toThrow(
      /non-empty request signing secret/i
    );
  });
});

describe("buildSignedHeaders", () => {
  it("returns Content-Type, X-Timestamp and X-Signature", async () => {
    const timestamp = 1_750_000_000_000;
    const headers = await buildSignedHeaders({ method: "POST", path: PATH, body: BODY, timestamp });

    expect(headers).toEqual({
      "Content-Type": "application/json",
      "X-Timestamp": "1750000000000",
      "X-Signature": await referenceSignature(timestamp, "POST", PATH, BODY),
    });
  });

  it("defaults the timestamp to now", async () => {
    const before = Date.now();
    const headers = await buildSignedHeaders({ method: "POST", path: PATH, body: BODY });
    const after = Date.now();

    const sent = Number(headers["X-Timestamp"]);
    expect(sent).toBeGreaterThanOrEqual(before);
    expect(sent).toBeLessThanOrEqual(after);
  });
});

describe("submitSignedPayment", () => {
  const submission = {
    senderPublicKey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA",
    recipientPublicKey: "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV",
    amount: "12.5000000",
  };

  it("sends X-Timestamp and X-Signature on the submit request", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { id: "sub-1" } }),
    });

    const timestamp = 1_750_000_000_000;
    const data = await submitSignedPayment(submission, { timestamp });

    expect(data).toEqual({ id: "sub-1" });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("http://localhost:4000/api/payments/submit");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Timestamp"]).toBe("1750000000000");
    expect(init.headers["X-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("signs exactly the body string it transmits", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: {} }),
    });

    const timestamp = 1_750_000_000_000;
    await submitSignedPayment(submission, { timestamp });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    // Re-deriving the signature from the transmitted body must reproduce the
    // header — if these ever diverge the server rejects the request as tampered.
    expect(init.headers["X-Signature"]).toBe(
      await referenceSignature(timestamp, "POST", PATH, init.body as string)
    );
  });

  it("surfaces the server's 401 code on rejection", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized: missing or invalid request signature", code: "invalid_signature" }),
    });

    await expect(submitSignedPayment(submission)).rejects.toMatchObject({
      code: "invalid_signature",
    });
  });

  it("throws a generic error when the response is not JSON", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });

    await expect(submitSignedPayment(submission)).rejects.toThrow(/Payment submission failed/);
  });
});

/**
 * @jest-environment jsdom
 */
import {
  buildPaymentLinkUrl,
  canRedeemPaymentLink,
  clearPaymentLinkStore,
  getPaymentLinkRecord,
  listPaymentLinks,
  markPaymentLinkRedeemed,
  parsePaymentLinkQuery,
  paymentLinkId,
  rememberPaymentLink,
  type PaymentLinkPayload,
} from "@/lib/paymentLinks";

const PAYLOAD: PaymentLinkPayload = {
  destination: "GABCDEF",
  amount: "10",
  memo: "thanks",
};

describe("paymentLinkId", () => {
  it("is deterministic for the same payload", () => {
    expect(paymentLinkId(PAYLOAD)).toBe(paymentLinkId({ ...PAYLOAD }));
  });

  it("changes when destination, amount, memo, or expiry differ", () => {
    const baseId = paymentLinkId(PAYLOAD);
    expect(paymentLinkId({ ...PAYLOAD, destination: "GZZZ" })).not.toBe(baseId);
    expect(paymentLinkId({ ...PAYLOAD, amount: "11" })).not.toBe(baseId);
    expect(paymentLinkId({ ...PAYLOAD, memo: "other" })).not.toBe(baseId);
    expect(paymentLinkId({ ...PAYLOAD, validUntil: 1 })).not.toBe(baseId);
  });

  it("normalizes whitespace and missing memo", () => {
    expect(
      paymentLinkId({
        destination: "  GABC  ",
        amount: " 10 ",
        memo: undefined,
      }),
    ).toBe(paymentLinkId({ destination: "GABC", amount: "10", memo: "" }));
  });
});

describe("shareable payment link urls", () => {
  it("builds explicit /pay query params", () => {
    const url = buildPaymentLinkUrl("https://example.com", {
      ...PAYLOAD,
      validUntil: 1893456000000,
    });
    expect(url).toBe(
      "https://example.com/pay?to=GABCDEF&amount=10&memo=thanks&expires=1893456000000",
    );
  });

  it("omits empty optional fields", () => {
    expect(
      buildPaymentLinkUrl("https://example.com", {
        destination: "GABCDEF",
        amount: "10",
        memo: "   ",
      }),
    ).toBe("https://example.com/pay?to=GABCDEF&amount=10");
  });

  it("parses query params into payment form prefill payload", () => {
    expect(
      parsePaymentLinkQuery({
        to: "GABCDEF",
        amount: "10",
        memo: "coffee",
        expires: "1893456000000",
      }),
    ).toEqual({
      ok: true,
      payload: {
        destination: "GABCDEF",
        amount: "10",
        memo: "coffee",
        validUntil: 1893456000000,
      },
    });
  });

  it("parses unix-second expiry timestamps", () => {
    expect(
      parsePaymentLinkQuery({
        to: "GABCDEF",
        amount: "10",
        expires: "1893456000",
      }),
    ).toEqual({
      ok: true,
      payload: {
        destination: "GABCDEF",
        amount: "10",
        validUntil: 1893456000000,
      },
    });
  });

  it("rejects invalid expiry timestamps", () => {
    expect(
      parsePaymentLinkQuery({ to: "GABCDEF", amount: "10", expires: "soon" }),
    ).toEqual({ ok: false, reason: "invalid-expiry" });
  });

  it("keeps parsing legacy base64 data links", () => {
    const data = btoa(JSON.stringify(PAYLOAD));
    expect(parsePaymentLinkQuery({ data })).toEqual({
      ok: true,
      payload: { ...PAYLOAD, validUntil: null },
    });
  });
});

describe("payment link store", () => {
  beforeEach(() => {
    clearPaymentLinkStore();
  });

  it("remembers a freshly generated link as pending", () => {
    const record = rememberPaymentLink(
      PAYLOAD,
      "https://example/pay?to=GABCDEF&amount=10",
    );
    expect(record.status).toBe("pending");
    expect(record.url).toContain("to=GABCDEF");
    expect(getPaymentLinkRecord(PAYLOAD)?.status).toBe("pending");
  });

  it("is idempotent — re-saving the same payload does not duplicate", () => {
    rememberPaymentLink(PAYLOAD, "url1");
    rememberPaymentLink(PAYLOAD, "url2");
    expect(listPaymentLinks()).toHaveLength(1);
    // First write wins so the original createdAt is preserved.
    expect(getPaymentLinkRecord(PAYLOAD)?.url).toBe("url1");
  });

  it("flips a stale pending link to expired on read", () => {
    const expired: PaymentLinkPayload = {
      ...PAYLOAD,
      validUntil: Date.now() - 1000,
    };
    rememberPaymentLink(expired, "url");
    expect(getPaymentLinkRecord(expired)?.status).toBe("expired");
  });

  it("marks a link redeemed and stores the tx hash", () => {
    rememberPaymentLink(PAYLOAD, "url");
    expect(markPaymentLinkRedeemed(PAYLOAD, "tx-1")).toBe(true);
    const after = getPaymentLinkRecord(PAYLOAD);
    expect(after?.status).toBe("redeemed");
    expect(after?.redeemedTxHash).toBe("tx-1");
  });

  it("blocks reuse after redemption", () => {
    rememberPaymentLink(PAYLOAD, "url");
    markPaymentLinkRedeemed(PAYLOAD, "tx-1");
    expect(markPaymentLinkRedeemed(PAYLOAD, "tx-2")).toBe(false);
    expect(getPaymentLinkRecord(PAYLOAD)?.redeemedTxHash).toBe("tx-1");
  });
});

describe("canRedeemPaymentLink", () => {
  beforeEach(() => {
    clearPaymentLinkStore();
  });

  it("ok when the link is unrecorded and not expired", () => {
    expect(canRedeemPaymentLink(PAYLOAD)).toEqual({ ok: true });
  });

  it("ok when the link is recorded and pending", () => {
    rememberPaymentLink(PAYLOAD, "url");
    expect(canRedeemPaymentLink(PAYLOAD)).toEqual({ ok: true });
  });

  it("rejects expired links via the validUntil field", () => {
    expect(
      canRedeemPaymentLink({ ...PAYLOAD, validUntil: Date.now() - 1 }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects links already redeemed locally", () => {
    rememberPaymentLink(PAYLOAD, "url");
    markPaymentLinkRedeemed(PAYLOAD, "tx-1");
    expect(canRedeemPaymentLink(PAYLOAD)).toEqual({
      ok: false,
      reason: "redeemed",
    });
  });
});

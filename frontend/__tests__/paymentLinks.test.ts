/**
 * @jest-environment jsdom
 */
import {
  canRedeemPaymentLink,
  clearPaymentLinkStore,
  getPaymentLinkRecord,
  listPaymentLinks,
  markPaymentLinkRedeemed,
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
      paymentLinkId({ destination: "  GABC  ", amount: " 10 ", memo: undefined })
    ).toBe(
      paymentLinkId({ destination: "GABC", amount: "10", memo: "" })
    );
  });
});

describe("payment link store", () => {
  beforeEach(() => {
    clearPaymentLinkStore();
  });

  it("remembers a freshly generated link as pending", () => {
    const record = rememberPaymentLink(PAYLOAD, "https://example/pay?data=…");
    expect(record.status).toBe("pending");
    expect(record.url).toContain("data");
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
      canRedeemPaymentLink({ ...PAYLOAD, validUntil: Date.now() - 1 })
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

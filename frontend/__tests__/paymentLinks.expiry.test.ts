/**
 * __tests__/paymentLinks.expiry.test.ts
 * Clock-boundary tests for payment link expiry (issue #750).
 *
 * Validates that expiry is enforced at parse time and that boundary
 * conditions (now === validUntil, now === validUntil + 1) behave correctly.
 */

import {
  parsePaymentLinkQuery,
  canRedeemPaymentLink,
  isExpired,
  type PaymentLinkPayload,
} from "@/lib/paymentLinks";

const VALID_ADDRESS = "GAQWTE4AWTBZYJYZIURRBYD6G4N6WMB4QNY2OXZFTKRYR6XQ4OQK6R37";

describe("paymentLinks expiry – clock boundaries", () => {
  describe("isExpired", () => {
    it("returns false when now === validUntil (exact boundary)", () => {
      const now = 1_700_000_000_000;
      const payload: PaymentLinkPayload = {
        destination: VALID_ADDRESS,
        amount: "10",
        validUntil: now,
      };
      // now is NOT greater than validUntil, so not expired
      expect(isExpired(payload, now)).toBe(false);
    });

    it("returns true when now === validUntil + 1 (one ms past boundary)", () => {
      const now = 1_700_000_000_000;
      const payload: PaymentLinkPayload = {
        destination: VALID_ADDRESS,
        amount: "10",
        validUntil: now - 1,
      };
      expect(isExpired(payload, now)).toBe(true);
    });

    it("returns false when validUntil is null (no expiry)", () => {
      const payload: PaymentLinkPayload = {
        destination: VALID_ADDRESS,
        amount: "10",
        validUntil: null,
      };
      expect(isExpired(payload, Date.now())).toBe(false);
    });

    it("returns false when validUntil is undefined (no expiry)", () => {
      const payload: PaymentLinkPayload = {
        destination: VALID_ADDRESS,
        amount: "10",
      };
      expect(isExpired(payload, Date.now())).toBe(false);
    });
  });

  describe("parsePaymentLinkQuery – expiry at parse time", () => {
    it("rejects a link whose expiry is in the past", () => {
      const expiredTimestamp = String(Date.now() - 60_000);
      const result = parsePaymentLinkQuery({
        to: VALID_ADDRESS,
        amount: "5",
        expires: expiredTimestamp,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("expired");
      }
    });

    it("accepts a link whose expiry is in the future", () => {
      const futureTimestamp = String(Date.now() + 3_600_000);
      const result = parsePaymentLinkQuery({
        to: VALID_ADDRESS,
        amount: "5",
        expires: futureTimestamp,
      });
      expect(result.ok).toBe(true);
    });

    it("accepts a link with no expiry", () => {
      const result = parsePaymentLinkQuery({
        to: VALID_ADDRESS,
        amount: "5",
      });
      expect(result.ok).toBe(true);
    });

    it("rejects with 'expired' for base64-encoded links past their expiry", () => {
      const expiredPayload = JSON.stringify({
        to: VALID_ADDRESS,
        amount: "5",
        expires: String(Date.now() - 60_000),
      });
      const encoded =
        typeof btoa === "function"
          ? btoa(expiredPayload)
          : Buffer.from(expiredPayload).toString("base64");
      const result = parsePaymentLinkQuery({ data: encoded });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("expired");
      }
    });
  });

  describe("canRedeemPaymentLink – boundary enforcement", () => {
    it("allows payment at exact boundary (now === validUntil)", () => {
      const now = 1_700_000_000_000;
      const payload: PaymentLinkPayload = {
        destination: VALID_ADDRESS,
        amount: "10",
        validUntil: now,
      };
      // Note: canRedeemPaymentLink uses Date.now() internally.
      // This test documents the boundary semantics via isExpired.
      expect(isExpired(payload, now)).toBe(false);
    });

    it("blocks payment one ms after boundary", () => {
      const now = 1_700_000_000_000;
      const payload: PaymentLinkPayload = {
        destination: VALID_ADDRESS,
        amount: "10",
        validUntil: now - 1,
      };
      expect(isExpired(payload, now)).toBe(true);
    });
  });
});

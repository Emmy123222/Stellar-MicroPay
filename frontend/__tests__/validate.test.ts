import {
  extractAmountFromString,
  isValidStellarAddress,
  parsePaymentAmount,
} from "@/utils/validate";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("validate boundaries", () => {
  describe("isValidStellarAddress", () => {
    it.each([VALID_ADDRESS, "G" + "2".repeat(55)])("accepts valid address %s", (value) => {
      expect(isValidStellarAddress(value)).toBe(true);
    });
    it.each(["", "G" + "A".repeat(54), "G" + "0".repeat(55), "N" + "A".repeat(55)])(
      "rejects invalid address %s",
      (value) => expect(isValidStellarAddress(value)).toBe(false)
    );
  });

  describe("extractAmountFromString", () => {
    it.each([["50 XLM", "50"], ["0.125 USDC", "0.125"], ["", ""]])(
      "extracts %s",
      (input, expected) => expect(extractAmountFromString(input)).toBe(expected)
    );
  });

  describe("parsePaymentAmount", () => {
    it.each([
      ["50 XLM", { amount: "50", currency: "XLM" }],
      ["0.125 usdc", { amount: "0.125", currency: "USDC" }],
      ["", { amount: "", currency: "" }],
      ["not money", { amount: "", currency: "" }],
    ])("parses %s", (input, expected) => expect(parsePaymentAmount(input)).toEqual(expected));
  });
});

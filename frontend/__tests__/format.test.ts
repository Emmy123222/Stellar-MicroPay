import { formatUSD } from "@/utils/format";

describe("formatUSD", () => {
  it("formats a typical value with 2 decimal places", () => {
    expect(formatUSD(142.5)).toBe("≈ $142.50 USD");
  });

  it("formats zero", () => {
    expect(formatUSD(0)).toBe("≈ $0.00 USD");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatUSD(1.005)).toBe("≈ $1.01 USD");
  });

  it("formats large values with comma separators", () => {
    expect(formatUSD(1234567.89)).toBe("≈ $1,234,567.89 USD");
  });
});

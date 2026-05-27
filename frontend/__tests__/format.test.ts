import { formatAsset, formatUSD, formatXLM } from "@/utils/format";

describe("formatAsset", () => {
  it("preserves XLM formatting with up to 7 decimal places", () => {
    expect(formatXLM(1.2345678)).toBe("1.2345678 XLM");
    expect(formatAsset("12.5", "XLM")).toBe("12.5 XLM");
  });

  it("formats USDC with 2 fixed decimal places", () => {
    expect(formatAsset("15", "USDC")).toBe("15.00 USDC");
    expect(formatAsset(1.235, "usdc")).toBe("1.24 USDC");
  });

  it("falls back to the default asset precision for unknown assets", () => {
    expect(formatAsset("9.87654321", "AQUA")).toBe("9.8765432 AQUA");
  });

  it("handles invalid values safely", () => {
    expect(formatAsset("not-a-number", "USDC")).toBe("0.00 USDC");
    expect(formatAsset("not-a-number", "XLM")).toBe("0 XLM");
  });
});

describe("formatUSD", () => {
  it("formats a typical value with 2 decimal places", () => {
    expect(formatUSD(142.5)).toBe("\u2248 $142.50 USD");
  });

  it("formats zero", () => {
    expect(formatUSD(0)).toBe("\u2248 $0.00 USD");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatUSD(1.005)).toBe("\u2248 $1.01 USD");
  });

  it("formats large values with comma separators", () => {
    expect(formatUSD(1234567.89)).toBe("\u2248 $1,234,567.89 USD");
  });
});

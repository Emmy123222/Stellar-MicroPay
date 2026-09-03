import {
  formatAsset,
  formatAssetPrecise,
  formatUSD,
  formatXLM,
  formatXLMPrecise,
  parseBatchRecipientsCSV,
  timeAgo,
  clampAmount,
} from "@/utils/format";

describe("formatAsset", () => {
  it("preserves XLM formatting with up to 7 decimal places", () => {
    expect(formatXLM(1.2345678)).toBe("1.2345678 XLM");
    expect(formatAsset("12.5", "XLM")).toBe("12.5 XLM");
  });

  it("formats formatXLM(0) as 0 XLM", () => {
    expect(formatXLM(0)).toBe("0 XLM");
  });

  it("formats formatXLM('1.2345678') as 1.2345678 XLM", () => {
    expect(formatXLM("1.2345678")).toBe("1.2345678 XLM");
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

describe("timeAgo", () => {
  it("returns relative time string for a known past date", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinutesAgo)).toBe("5 minutes ago");
  });
});

describe("clampAmount", () => {
  it("returns min when value is 'abc'", () => {
    expect(clampAmount("abc")).toBe(0.0000001);
  });

  it("clamps amount correctly within min and max boundaries", () => {
    expect(clampAmount("0.00000001")).toBe(0.0000001);
    expect(clampAmount("1000000")).toBe(999999);
    expect(clampAmount("5.5")).toBe(5.5);
  });
});

describe("formatAssetPrecise", () => {
  it("keeps trailing zeros at the asset's full precision", () => {
    expect(formatXLMPrecise(10)).toBe("10.0000000 XLM");
    expect(formatXLMPrecise("2.5")).toBe("2.5000000 XLM");
    expect(formatAssetPrecise("15", "USDC")).toBe("15.00 USDC");
  });

  it("falls back to zero for invalid values", () => {
    expect(formatXLMPrecise("not-a-number")).toBe("0.0000000 XLM");
  });
});

describe("parseBatchRecipientsCSV", () => {
  const ADDRESS_A = "GAAA1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
  const ADDRESS_B = "GBBB1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";

  it("reads address, amount and memo columns from a header row", () => {
    const rows = parseBatchRecipientsCSV(
      `address,amount,memo\n${ADDRESS_A},2.5,Rent\n${ADDRESS_B},7.5,Salary`
    );

    expect(rows).toEqual([
      { rowNumber: 2, address: ADDRESS_A, amount: "2.5", memo: "Rent", error: null },
      { rowNumber: 3, address: ADDRESS_B, amount: "7.5", memo: "Salary", error: null },
    ]);
  });

  it("honours a reordered header row", () => {
    const rows = parseBatchRecipientsCSV(`amount,memo,recipient\n3,Note,${ADDRESS_A}`);

    expect(rows[0]).toMatchObject({ address: ADDRESS_A, amount: "3", memo: "Note", error: null });
  });

  it("reads columns positionally when there is no header", () => {
    const rows = parseBatchRecipientsCSV(`${ADDRESS_A},1.25,Coffee`);

    expect(rows[0]).toMatchObject({
      rowNumber: 1,
      address: ADDRESS_A,
      amount: "1.25",
      memo: "Coffee",
    });
  });

  it("flags malformed rows without dropping them", () => {
    const rows = parseBatchRecipientsCSV(
      `address,amount,memo\n${ADDRESS_A},2,Fine\n,1,No address\n${ADDRESS_B},abc,Bad amount\n${ADDRESS_B},-1,Negative\n${ADDRESS_B},,No amount`
    );

    expect(rows).toHaveLength(5);
    expect(rows[0].error).toBeNull();
    expect(rows[1].error).toMatch(/Missing recipient address/);
    expect(rows[2].error).toMatch(/greater than 0/);
    expect(rows[3].error).toMatch(/greater than 0/);
    expect(rows[4].error).toMatch(/Missing amount/);
  });

  it("supports quoted memos containing commas", () => {
    const rows = parseBatchRecipientsCSV(`${ADDRESS_A},2,"Rent, June"`);

    expect(rows[0].memo).toBe("Rent, June");
  });

  it("returns no rows for an empty file", () => {
    expect(parseBatchRecipientsCSV("")).toEqual([]);
    expect(parseBatchRecipientsCSV("\n\n")).toEqual([]);
  });
});

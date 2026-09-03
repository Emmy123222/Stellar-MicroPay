/**
 * __tests__/resolveStellarName.test.ts
 *
 * Unit tests for `resolveStellarName`, `isStellarName`, and `clearNameCache`
 * in lib/stellar.ts — covering successful resolution, cache behaviour (TTL
 * hit and miss), error propagation, and the raw-address bypass path.
 */

import {
  resolveStellarName,
  isStellarName,
  clearNameCache,
  isValidStellarAddress,
} from "@/lib/stellar";

// ─── Mock stellar-sdk Federation ─────────────────────────────────────────────
// We mock only the Federation.Server.resolve call so the rest of the module
// (isValidStellarAddress, etc.) runs as real code.

const mockResolve = jest.fn();

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Federation: {
      Server: {
        resolve: (...args: unknown[]) => mockResolve(...args),
      },
    },
  };
});

const VALID_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNN";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function advanceSystemTimerBy(ms: number) {
  jest.setSystemTime(Date.now() + ms);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("isStellarName", () => {
  it("returns true for .xlm suffix names", () => {
    expect(isStellarName("alice.xlm")).toBe(true);
    expect(isStellarName("ALICE.XLM")).toBe(true);
    expect(isStellarName("  alice.xlm  ")).toBe(true);
  });

  it("returns true for federation name*domain format", () => {
    expect(isStellarName("alice*stellar.org")).toBe(true);
    expect(isStellarName("user*example.com")).toBe(true);
  });

  it("returns false for raw G... public keys", () => {
    expect(isStellarName(VALID_ADDRESS)).toBe(false);
  });

  it("returns false for usernames without * or .xlm", () => {
    expect(isStellarName("@alice")).toBe(false);
    expect(isStellarName("alice")).toBe(false);
    expect(isStellarName("")).toBe(false);
  });
});

describe("resolveStellarName", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clearNameCache();
    mockResolve.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("raw address bypass", () => {
    it("returns a valid G... address as-is without calling Federation.Server.resolve", async () => {
      const result = await resolveStellarName(VALID_ADDRESS);
      expect(result).toBe(VALID_ADDRESS);
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("trims whitespace from raw addresses before returning", async () => {
      const result = await resolveStellarName(`  ${VALID_ADDRESS}  `);
      expect(result).toBe(VALID_ADDRESS);
    });
  });

  describe("successful resolution", () => {
    it("resolves a .xlm name by translating to name*stellarnames.org", async () => {
      mockResolve.mockResolvedValue({ account_id: VALID_ADDRESS });

      const result = await resolveStellarName("alice.xlm");

      expect(result).toBe(VALID_ADDRESS);
      expect(mockResolve).toHaveBeenCalledWith("alice*stellarnames.org");
    });

    it("resolves a federation address directly", async () => {
      mockResolve.mockResolvedValue({ account_id: VALID_ADDRESS });

      const result = await resolveStellarName("alice*domain.com");

      expect(result).toBe(VALID_ADDRESS);
      expect(mockResolve).toHaveBeenCalledWith("alice*domain.com");
    });

    it("is case-insensitive for .xlm names", async () => {
      mockResolve.mockResolvedValue({ account_id: VALID_ADDRESS });

      await resolveStellarName("ALICE.XLM");
      expect(mockResolve).toHaveBeenCalledWith("alice*stellarnames.org");
    });
  });

  describe("cache behaviour", () => {
    it("returns cached address on second call within TTL (does not call resolve again)", async () => {
      mockResolve.mockResolvedValue({ account_id: VALID_ADDRESS });

      const first = await resolveStellarName("alice.xlm");
      const second = await resolveStellarName("alice.xlm");

      expect(first).toBe(VALID_ADDRESS);
      expect(second).toBe(VALID_ADDRESS);
      // Only one network call despite two resolution calls
      expect(mockResolve).toHaveBeenCalledTimes(1);
    });

    it("calls resolve again after the 10-minute TTL has expired", async () => {
      mockResolve.mockResolvedValue({ account_id: VALID_ADDRESS });

      await resolveStellarName("alice.xlm");
      expect(mockResolve).toHaveBeenCalledTimes(1);

      // Advance past the 10-minute TTL
      advanceSystemTimerBy(10 * 60 * 1000 + 1);

      await resolveStellarName("alice.xlm");
      expect(mockResolve).toHaveBeenCalledTimes(2);
    });

    it("still returns cached address if called 1ms before TTL expires", async () => {
      mockResolve.mockResolvedValue({ account_id: VALID_ADDRESS });

      await resolveStellarName("alice.xlm");

      // Advance to just before expiry
      advanceSystemTimerBy(10 * 60 * 1000 - 1);

      await resolveStellarName("alice.xlm");
      expect(mockResolve).toHaveBeenCalledTimes(1);
    });

    it("clearNameCache() forces a fresh lookup on next call", async () => {
      mockResolve.mockResolvedValue({ account_id: VALID_ADDRESS });

      await resolveStellarName("alice.xlm");
      clearNameCache();
      await resolveStellarName("alice.xlm");

      expect(mockResolve).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("throws a clear error when the name cannot be resolved", async () => {
      mockResolve.mockRejectedValue(new Error("Not found"));

      await expect(resolveStellarName("unknown.xlm")).rejects.toThrow(
        /Could not resolve "unknown\.xlm"/
      );
    });

    it("throws for input that is not a name or a valid address", async () => {
      await expect(resolveStellarName("notaname")).rejects.toThrow(/Could not resolve "notaname"/);
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("throws when federation server returns no account_id", async () => {
      mockResolve.mockResolvedValue({ account_id: null });

      await expect(resolveStellarName("alice.xlm")).rejects.toThrow(
        /Could not resolve "alice\.xlm"/
      );
    });

    it("does not cache failed resolutions", async () => {
      mockResolve
        .mockRejectedValueOnce(new Error("Server error"))
        .mockResolvedValueOnce({ account_id: VALID_ADDRESS });

      await expect(resolveStellarName("alice.xlm")).rejects.toThrow();

      // Second call should try again (not use a cached failure)
      const result = await resolveStellarName("alice.xlm");
      expect(result).toBe(VALID_ADDRESS);
      expect(mockResolve).toHaveBeenCalledTimes(2);
    });
  });
});

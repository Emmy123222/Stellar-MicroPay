/**
 * __tests__/isValidStellarAddress.property.test.ts
 *
 * Property-based tests for `isValidStellarAddress` (frontend) using fast-check.
 *
 * Properties verified:
 *  1. Never throws on any input — always returns a boolean.
 *  2. Returns true for every well-formed Stellar public key.
 *  3. Returns false for every string that does not match the canonical format.
 *  4. Frontend and backend agree: isValidStellarAddress(x) === !validatePublicKey throws(x)
 *     for all string inputs (cross-boundary consistency).
 */

import fc from "fast-check";
import { isValidStellarAddress } from "@/lib/stellar";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Characters allowed in a Stellar public key after the leading 'G'. */
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Generates a syntactically valid Stellar public key:
 * 'G' followed by exactly 55 characters from the uppercase base32 alphabet.
 */
const validStellarKey = fc
  .stringOf(fc.constantFrom(...BASE32_CHARS.split("")), {
    minLength: 55,
    maxLength: 55,
  })
  .map((suffix) => `G${suffix}`);

// ─── Inline backend validator (mirrors stellarService.validatePublicKey) ─────
// Duplicated here so the frontend test has no runtime dependency on the backend.
// The cross-boundary consistency property verifies they agree on all inputs.

function backendValidatePublicKey(publicKey: unknown): void {
  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey as string)) {
    const err: NodeJS.ErrnoException = new Error("Invalid Stellar public key format");
    (err as any).status = 400;
    throw err;
  }
}

// ─── Properties ──────────────────────────────────────────────────────────────

describe("isValidStellarAddress — property-based tests", () => {
  /**
   * Property 1: Never throws — always returns a boolean.
   * The function must be total: no input should cause it to throw or return
   * a non-boolean value.
   */
  it("never throws and always returns a boolean for any string input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        let result: unknown;
        expect(() => {
          result = isValidStellarAddress(input);
        }).not.toThrow();
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 2000 }
    );
  });

  /**
   * Property 2: Returns true for every well-formed Stellar public key.
   */
  it("returns true for every syntactically valid Stellar public key", () => {
    fc.assert(
      fc.property(validStellarKey, (key) => {
        expect(isValidStellarAddress(key)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * Property 3: Returns false for strings that are clearly not valid keys.
   */
  it("returns false for strings that do not match the canonical format", () => {
    const invalidKey = fc.oneof(
      // Too short or too long
      fc.string({ minLength: 0, maxLength: 55 }),
      fc.string({ minLength: 57, maxLength: 200 }),
      // Correct length but wrong leading character
      fc
        .stringOf(fc.constantFrom(...BASE32_CHARS.split("")), {
          minLength: 56,
          maxLength: 56,
        })
        .filter((s) => !s.startsWith("G")),
      // Contains lowercase letters
      fc
        .string({ minLength: 56, maxLength: 56 })
        .filter((s) => /[a-z]/.test(s))
    );

    fc.assert(
      fc.property(invalidKey, (input) => {
        expect(isValidStellarAddress(input)).toBe(false);
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * Property 4: Cross-boundary consistency.
   * isValidStellarAddress(x) must agree with the backend's validatePublicKey(x)
   * on every arbitrary string input. If the backend throws, the frontend must
   * return false. If the backend accepts, the frontend must return true.
   *
   * This ensures both implementations share the same acceptance criteria and
   * that no input is accepted by one side but rejected by the other.
   */
  it("agrees with the backend validatePublicKey on every arbitrary string input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        let backendAccepts: boolean;
        try {
          backendValidatePublicKey(input);
          backendAccepts = true;
        } catch {
          backendAccepts = false;
        }

        const frontendAccepts = isValidStellarAddress(input);

        expect(frontendAccepts).toBe(backendAccepts);
      }),
      { numRuns: 2000 }
    );
  });

  /**
   * Property 5: Idempotent — calling it twice on the same input gives the
   * same result. Validates there is no hidden mutable state.
   */
  it("is idempotent — same input always produces the same result", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(isValidStellarAddress(input)).toBe(isValidStellarAddress(input));
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * Spot-check: known valid and invalid values.
   */
  it("handles known edge cases correctly", () => {
    // Valid — real-looking testnet key (all uppercase base32, 56 chars)
    expect(isValidStellarAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNN")).toBe(true);

    // Invalid — empty string
    expect(isValidStellarAddress("")).toBe(false);

    // Invalid — starts with S (secret key prefix)
    expect(isValidStellarAddress("SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")).toBe(false);

    // Invalid — 55 chars (one short)
    expect(isValidStellarAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH")).toBe(false);

    // Invalid — 57 chars (one long)
    expect(isValidStellarAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHFF")).toBe(false);

    // Invalid — contains lowercase
    expect(isValidStellarAddress("Gaazi4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")).toBe(false);

    // Invalid — contains special characters
    expect(isValidStellarAddress("G!AZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")).toBe(false);
  });
});

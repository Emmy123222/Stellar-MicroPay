/**
 * __tests__/validatePublicKey.property.test.js
 *
 * Property-based tests for `validatePublicKey` (backend) using fast-check.
 *
 * Properties verified:
 *  1. Never throws unexpectedly — always throws an Error (never crashes the
 *     process with a non-Error value) on any arbitrary string input.
 *  2. Accepts every well-formed Stellar public key (G + 55 uppercase base32
 *     chars) without throwing.
 *  3. Rejects every string that does NOT match the canonical format.
 *  4. Rejects null / undefined / non-string values without crashing.
 */

"use strict";

const fc = require("fast-check");
const { validatePublicKey } = require("../src/services/stellarService");

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

// ─── Properties ──────────────────────────────────────────────────────────────

describe("validatePublicKey — property-based tests", () => {
  /**
   * Property 1: Never throws a non-Error value on any string input.
   * The function must always throw a proper Error instance (never a string,
   * number, or undefined) so callers can safely catch and inspect `.message`.
   */
  it("always throws an Error instance (never a non-Error) on invalid input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        try {
          validatePublicKey(input);
          // If it didn't throw, the key was valid — that's fine.
          return true;
        } catch (err) {
          // Must be a proper Error, not a raw string/number/etc.
          expect(err).toBeInstanceOf(Error);
          expect(typeof err.message).toBe("string");
          return true;
        }
      }),
      { numRuns: 2000 }
    );
  });

  /**
   * Property 2: Accepts every syntactically valid Stellar public key.
   * A key matching /^G[A-Z2-7]{55}$/ must never throw.
   */
  it("accepts every well-formed Stellar public key without throwing", () => {
    fc.assert(
      fc.property(validStellarKey, (key) => {
        expect(() => validatePublicKey(key)).not.toThrow();
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * Property 3: Rejects strings that are clearly not valid keys.
   * Any string that does NOT match /^G[A-Z0-9]{55}$/ must throw.
   */
  it("rejects every string that does not match the canonical format", () => {
    // Strings that are too short, too long, wrong prefix, or contain
    // lowercase / special characters.
    const invalidKey = fc.oneof(
      // Wrong length (not 56 chars total)
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
      fc.string({ minLength: 56, maxLength: 56 }).filter((s) =>
        /[a-z]/.test(s)
      )
    );

    fc.assert(
      fc.property(invalidKey, (input) => {
        expect(() => validatePublicKey(input)).toThrow();
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * Property 4: Handles non-string inputs gracefully.
   * null, undefined, numbers, objects, and arrays must all throw an Error
   * rather than crashing with a TypeError or returning silently.
   */
  it("throws an Error (not a crash) for non-string inputs", () => {
    const nonStrings = [null, undefined, 0, 42, true, false, {}, [], Symbol("x")];

    for (const value of nonStrings) {
      expect(() => validatePublicKey(value)).toThrow(Error);
    }
  });

  /**
   * Property 5: The thrown error always carries status 400.
   * Callers rely on err.status to return the correct HTTP response code.
   */
  it("always sets err.status = 400 on rejection", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^G[A-Z0-9]{55}$/.test(s)),
        (invalidInput) => {
          try {
            validatePublicKey(invalidInput);
          } catch (err) {
            expect(err.status).toBe(400);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });
});

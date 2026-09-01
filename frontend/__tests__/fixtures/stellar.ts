/**
 * frontend/__tests__/fixtures/stellar.ts
 * Shared Keypair-based test fixtures and factories for Stellar keys and addresses.
 *
 * Provides real, StrKey-compliant Stellar public/secret keys with valid CRC16 checksums,
 * replacing hand-crafted "G" + "A".repeat(55) strings that fail SDK validation.
 */

import { Keypair, StrKey } from "@stellar/stellar-sdk";

/**
 * Generate a deterministic valid Stellar public key (G... with valid CRC16 StrKey checksum).
 */
export function createDeterministicPublicKey(seedByte: number | string = 1): string {
  const byte = typeof seedByte === "number" ? seedByte : (seedByte.charCodeAt(0) || 1);
  const data = Buffer.alloc(32, byte % 256);
  return StrKey.encodeEd25519PublicKey(data);
}

/**
 * Generate a deterministic valid Stellar secret key (S... with valid CRC16 StrKey checksum).
 */
export function createDeterministicSecretKey(seedByte: number | string = 1): string {
  const byte = typeof seedByte === "number" ? seedByte : (seedByte.charCodeAt(0) || 1);
  const data = Buffer.alloc(32, byte % 256);
  return StrKey.encodeEd25519SecretSeed(data);
}

/**
 * Generate a deterministic Keypair from a 1-byte or string seed for reproducible tests.
 */
export function createDeterministicKeypair(seedByte: number | string = 1): Keypair {
  const pub = createDeterministicPublicKey(seedByte);
  return Keypair.fromPublicKey(pub);
}

/**
 * Generate a new random Stellar public key with valid StrKey checksums.
 */
export function generateValidPublicKey(): string {
  const randomBytes = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    randomBytes[i] = Math.floor(Math.random() * 256);
  }
  return StrKey.encodeEd25519PublicKey(randomBytes);
}

/**
 * Generate a new random Stellar secret key with valid StrKey checksums.
 */
export function generateValidSecretKey(): string {
  const randomBytes = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    randomBytes[i] = Math.floor(Math.random() * 256);
  }
  return StrKey.encodeEd25519SecretSeed(randomBytes);
}

/**
 * Generate a new random Keypair with valid StrKey checksums.
 */
export function generateValidKeypair(): Keypair {
  return Keypair.fromPublicKey(generateValidPublicKey());
}

/**
 * Returns a 56-character string starting with 'G' whose StrKey CRC16 checksum is invalid.
 * Used to test checksum validation vs length checking.
 */
export function createInvalidChecksumPublicKey(): string {
  return "G" + "A".repeat(55);
}

/**
 * Returns a string with invalid length (e.g. 55 or 57 chars).
 */
export function createInvalidLengthPublicKey(length = 55): string {
  return "G" + "A".repeat(Math.max(0, length - 1));
}

// Pre-generated deterministic fixtures for standard test suites
export const TEST_PUBLIC_KEY_A = createDeterministicPublicKey(1);
export const TEST_PUBLIC_KEY_B = createDeterministicPublicKey(2);
export const TEST_PUBLIC_KEY_C = createDeterministicPublicKey(3);

export const TEST_KEYPAIR_A = createDeterministicKeypair(1);
export const TEST_KEYPAIR_B = createDeterministicKeypair(2);
export const TEST_KEYPAIR_C = createDeterministicKeypair(3);

export const isValidEd25519PublicKey = StrKey.isValidEd25519PublicKey;

describe("frontend stellar fixture factories", () => {
  it("generates valid Ed25519 public keys with correct StrKey checksums", () => {
    expect(StrKey.isValidEd25519PublicKey(TEST_PUBLIC_KEY_A)).toBe(true);
    expect(StrKey.isValidEd25519PublicKey(TEST_PUBLIC_KEY_B)).toBe(true);
    expect(StrKey.isValidEd25519PublicKey(TEST_PUBLIC_KEY_C)).toBe(true);
    expect(StrKey.isValidEd25519PublicKey(generateValidPublicKey())).toBe(true);
  });

  it("correctly identifies invalid checksums and lengths", () => {
    expect(StrKey.isValidEd25519PublicKey(createInvalidChecksumPublicKey())).toBe(false);
    expect(StrKey.isValidEd25519PublicKey(createInvalidLengthPublicKey(55))).toBe(false);
  });
});

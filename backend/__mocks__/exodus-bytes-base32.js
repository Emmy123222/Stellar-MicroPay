/**
 * CJS shim for `@exodus/bytes/base32.js`.
 *
 * `@stellar/stellar-sdk`'s CJS build `require()`s the ESM-only `@exodus/bytes`
 * package, which Jest cannot parse under Node 20. The SDK only uses the RFC
 * 4648 base32 helpers (`toBase32` / `fromBase32`) for strkey encoding, so we
 * provide a dependency-free CommonJS implementation for the test environment.
 */
"use strict";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(bytes, { padding = false } = {}) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | (byte & 0xff);
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }

  if (padding) {
    while (output.length % 8 !== 0) output += "=";
  }

  return output;
}

function fromBase32(str, { padding = "both" } = {}) {
  if (typeof str !== "string") {
    throw new TypeError("Expected a string");
  }

  if (padding === true && str.length % 8 !== 0) {
    throw new SyntaxError("Invalid base32 padding");
  }
  if (padding === false && str.endsWith("=")) {
    throw new SyntaxError("Did not expect padding in base32 input");
  }

  const clean = str.replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char.toUpperCase());
    if (index === -1) {
      throw new SyntaxError("Invalid character in base32 input");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

module.exports = {
  toBase32,
  fromBase32,
  toBase32hex: toBase32,
  fromBase32hex: fromBase32,
  toBase32crockford: toBase32,
  fromBase32crockford: fromBase32,
};

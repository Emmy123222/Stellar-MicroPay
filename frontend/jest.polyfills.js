/**
 * Jest polyfills.
 *
 * jsdom does not expose the WHATWG `TextEncoder`/`TextDecoder` globals that
 * `@stellar/stellar-sdk` v17 uses, so we wire Node's implementations in before
 * the test framework loads.
 */
const { TextEncoder, TextDecoder } = require("node:util");
const { webcrypto } = require("node:crypto");

if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

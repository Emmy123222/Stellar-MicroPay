/**
 * Jest polyfills.
 *
 * jsdom does not expose the WHATWG `TextEncoder`/`TextDecoder` globals that
 * `@stellar/stellar-sdk` v17 uses, so we wire Node's implementations in before
 * the test framework loads.
 */
const { TextEncoder, TextDecoder } = require("node:util");

if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}

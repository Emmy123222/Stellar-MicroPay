/**
 * CJS shim for `uint8array-extras`.
 *
 * `@stellar/stellar-sdk`'s CJS build `require()`s this ESM-only package, which
 * Jest cannot parse. The SDK only uses a small, stable subset of its API, so we
 * provide a CommonJS implementation for the test environment.
 */
const { Buffer } = require("buffer");

function isUint8Array(value) {
  return value instanceof Uint8Array;
}

function assertUint8Array(value) {
  if (!isUint8Array(value)) {
    throw new TypeError("Expected a Uint8Array");
  }
}

function assertUint8ArrayOrArrayBuffer(value) {
  if (!isUint8Array(value) && !(value instanceof ArrayBuffer)) {
    throw new TypeError("Expected a Uint8Array or ArrayBuffer");
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Expected a TypedArray or ArrayBuffer");
}

function concatUint8Arrays(arrays, totalLength) {
  const length =
    totalLength ?? arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function areUint8ArraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function compareUint8Arrays(a, b) {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

function uint8ArrayToString(array, encoding = "utf8") {
  return Buffer.from(array).toString(encoding);
}

function stringToUint8Array(string) {
  return new Uint8Array(Buffer.from(string, "utf8"));
}

function uint8ArrayToHex(array) {
  return Buffer.from(array).toString("hex");
}

function hexToUint8Array(hexString) {
  return new Uint8Array(Buffer.from(hexString, "hex"));
}

function uint8ArrayToBase64(array, options = {}) {
  const base64 = Buffer.from(array).toString("base64");
  return options.urlSafe
    ? base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    : base64;
}

function base64ToUint8Array(string) {
  return new Uint8Array(Buffer.from(string, "base64"));
}

function stringToBase64(string, options = {}) {
  const base64 = Buffer.from(string, "utf8").toString("base64");
  return options.urlSafe
    ? base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    : base64;
}

function base64ToString(base64String) {
  return Buffer.from(base64String, "base64").toString("utf8");
}

function getUintBE(view) {
  const { byteLength } = view;
  if (byteLength === 6) return view.getUint16(0) * 2 ** 32 + view.getUint32(2);
  if (byteLength === 5) return view.getUint8(0) * 2 ** 32 + view.getUint32(1);
  if (byteLength === 4) return view.getUint32(0);
  if (byteLength === 3) return view.getUint8(0) * 2 ** 16 + view.getUint16(1);
  if (byteLength === 2) return view.getUint16(0);
  if (byteLength === 1) return view.getUint8(0);
  throw new TypeError("Unsupported byte length");
}

function indexOf(array, value) {
  const length = value.length;
  if (length === 0) return 0;
  outer: for (let i = 0; i <= array.length - length; i += 1) {
    for (let j = 0; j < length; j += 1) {
      if (array[i + j] !== value[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function includes(array, value) {
  return indexOf(array, value) !== -1;
}

module.exports = {
  isUint8Array,
  assertUint8Array,
  assertUint8ArrayOrArrayBuffer,
  toUint8Array,
  concatUint8Arrays,
  areUint8ArraysEqual,
  compareUint8Arrays,
  uint8ArrayToString,
  stringToUint8Array,
  uint8ArrayToBase64,
  base64ToUint8Array,
  stringToBase64,
  base64ToString,
  uint8ArrayToHex,
  hexToUint8Array,
  getUintBE,
  indexOf,
  includes,
};

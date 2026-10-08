/**
 * Test-environment polyfills, registered from jest.config.ts via `setupFiles`.
 *
 * jsdom omits several globals that Node provides, and both are needed by the
 * request-signing helpers in lib/requestSignature.ts:
 *
 *  - TextEncoder/TextDecoder — jsdom does not expose them, and the Web Crypto
 *    HMAC path encodes to UTF-8 before signing.
 *  - SubtleCrypto — jsdom ships `crypto.getRandomValues` but no `subtle`, so
 *    `crypto.subtle.sign` would throw. Node's webcrypto is a complete drop-in
 *    and is swapped in only when `subtle` is actually missing, leaving jsdom's
 *    own implementation in place wherever one exists.
 */
import { TextDecoder, TextEncoder } from "util";
import { webcrypto } from "crypto";

Object.assign(global, {
  TextEncoder,
  TextDecoder,
});

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

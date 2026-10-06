/**
 * src/middleware/requestSignature.js
 * Express middleware enforcing the X-Timestamp / X-Signature pair.
 */

"use strict";

const {
  TIMESTAMP_HEADER,
  SIGNATURE_HEADER,
  getSigningSecret,
  verifyRequestSignature,
} = require("../utils/requestSignature");

/**
 * Reject requests that are not correctly signed and fresh.
 *
 * Every failure mode answers 401 with a stable `code`, so a client can tell
 * "your clock is wrong" (`expired_signature`) from "your signature does not
 * match" (`invalid_signature`) and react differently. The human-readable
 * `error` is intentionally vague about *which* part failed on the invalid and
 * missing paths — distinguishing them precisely would help an attacker tune an
 * attack for no benefit to a legitimate client, which can see both from the
 * documented contract.
 *
 * Requires the raw request body (`req.rawBody`) to be captured by the JSON body
 * parser; see the `verify` hook in server.js. Signing a re-serialised
 * `req.body` instead would depend on key ordering matching between client and
 * server, and a mismatch there is a silent bypass: the signature is checked
 * against bytes the client never sent.
 */
function requireSignedRequest(req, res, next) {
  const result = verifyRequestSignature({
    timestamp: req.get(TIMESTAMP_HEADER),
    signature: req.get(SIGNATURE_HEADER),
    method: req.method,
    // Signed over the path the client addressed, so a signature captured for
    // /api/payments/submit cannot be replayed against another endpoint.
    path: req.originalUrl.split("?")[0],
    body: req.rawBody,
  });

  if (!result.ok) {
    return res.status(401).json({
      error:
        result.code === "expired_signature"
          ? "Unauthorized: request timestamp outside the accepted window"
          : "Unauthorized: missing or invalid request signature",
      code: result.code,
    });
  }

  req.requestTimestamp = result.timestamp;
  return next();
}

module.exports = { requireSignedRequest, getSigningSecret, TIMESTAMP_HEADER, SIGNATURE_HEADER };

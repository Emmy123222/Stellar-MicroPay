/**
 * src/middleware/requestId.js
 * Assigns a correlation ID to every request so log lines and error
 * responses can be traced back to a single inbound call.
 */

"use strict";

const crypto = require("crypto");
const morgan = require("morgan");

const HEADER_NAME = "X-Request-ID";

// morgan format that appends the correlation ID to each log line.
const LOG_FORMAT = ":method :url :status :response-time ms - :request-id";

morgan.token("request-id", (req) => req.requestId || "-");

// Client-supplied IDs are echoed back, so they are constrained to a safe
// character set and length. This prevents log injection (CRLF, control
// characters) and unbounded header growth.
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Picks a request ID from the inbound header, or generates one.
 * Untrusted values that fail validation are discarded.
 *
 * @param {string} [inbound] - Raw X-Request-ID header value
 * @returns {string} A correlation-safe request ID
 */
function resolveRequestId(inbound) {
  if (typeof inbound === "string") {
    const trimmed = inbound.trim();
    if (SAFE_ID.test(trimmed)) {
      return trimmed;
    }
  }
  return crypto.randomUUID();
}

/**
 * Attaches req.requestId and echoes it back on the response.
 */
function requestId(req, res, next) {
  const id = resolveRequestId(req.headers[HEADER_NAME.toLowerCase()]);

  req.requestId = id;
  res.setHeader(HEADER_NAME, id);

  next();
}

module.exports = { requestId, resolveRequestId, HEADER_NAME, LOG_FORMAT };

/**
 * src/utils/sanitizeLogToken.js
 * Neutralize control characters in untrusted values written to access logs (#811).
 */

"use strict";

/** C0 controls and DEL — common log-forging and terminal escape vectors. */
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/g;

/**
 * Replace control characters in a single log token with spaces.
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeLogToken(value) {
  if (value == null) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).replace(CONTROL_CHAR_PATTERN, " ");
}

/**
 * Sanitize string values in a header map before logging.
 * @param {Record<string, unknown>|undefined|null} headers
 * @returns {Record<string, unknown>|undefined|null}
 */
function sanitizeLogHeaders(headers) {
  if (!headers || typeof headers !== "object") return headers;

  const sanitized = {};
  for (const [key, rawValue] of Object.entries(headers)) {
    if (Array.isArray(rawValue)) {
      sanitized[sanitizeLogToken(key)] = rawValue.map((entry) => sanitizeLogToken(entry));
    } else {
      sanitized[sanitizeLogToken(key)] = sanitizeLogToken(rawValue);
    }
  }
  return sanitized;
}

/**
 * Sanitize a serialized HTTP request record for structured access logs.
 * @param {Record<string, unknown>|undefined|null} record
 * @returns {Record<string, unknown>|undefined|null}
 */
function sanitizeReqLogRecord(record) {
  if (!record || typeof record !== "object") return record;

  return {
    ...record,
    url: sanitizeLogToken(record.url),
    remoteAddress: sanitizeLogToken(record.remoteAddress),
    headers: sanitizeLogHeaders(record.headers),
  };
}

/**
 * Sanitize a full access-log line before writing to stdout.
 * @param {unknown} line
 * @returns {string}
 */
function sanitizeAccessLogLine(line) {
  return sanitizeLogToken(line);
}

module.exports = {
  sanitizeLogToken,
  sanitizeLogHeaders,
  sanitizeReqLogRecord,
  sanitizeAccessLogLine,
};

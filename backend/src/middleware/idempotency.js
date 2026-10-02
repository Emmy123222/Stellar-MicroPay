/**
 * src/middleware/idempotency.js
 * Express middleware that makes an endpoint safe to retry.
 *
 * Reads the client-supplied `X-Idempotency-Key` header (a UUID), replays the
 * cached response when the same key is seen again within the TTL window, and
 * otherwise records the successful response for future retries.
 */

"use strict";

const idempotencyService = require("../services/idempotencyService");

const HEADER = "X-Idempotency-Key";
const REPLAY_HEADER = "X-Idempotency-Replayed";

function idempotency(req, res, next) {
  const key = req.get(HEADER);

  // Header is optional — requests without it behave exactly as before.
  if (!key) {
    return next();
  }

  if (!idempotencyService.isValidKey(key)) {
    return res.status(400).json({
      error: `${HEADER} must be a valid UUID`,
    });
  }

  // Duplicate request: replay the stored response verbatim (HTTP 200, not 409).
  const cached = idempotencyService.get(key);
  if (cached) {
    res.set(REPLAY_HEADER, "true");
    return res.status(cached.status || 200).json(cached.body);
  }

  // First request for this key — cache the response if it succeeds.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyService.set(key, { status: res.statusCode, body });
    }
    return originalJson(body);
  };

  return next();
}

module.exports = { idempotency, HEADER, REPLAY_HEADER };

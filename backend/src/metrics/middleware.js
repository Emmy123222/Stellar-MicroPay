/**
 * src/metrics/middleware.js
 * Express middleware that records HTTP request metrics for every inbound request.
 *
 * Handles latency, status codes, and error counts. Normalises dynamic route
 * segments (e.g. /api/accounts/GXXXX… → /api/accounts/:publicKey) so that
 * cardinality stays bounded.
 */

"use strict";

const {
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestErrors,
} = require("./registry");

/** Common dynamic path segments that should be replaced with :param. */
const DYNAMIC_SEGMENT_RE =
  /\/G[A-Z0-9]{55}(\/|$)|\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/g;

/**
 * Normalise a request path to a low-cardinality route label.
 * Strips query strings, replaces Stellar public keys and UUIDs with
 * placeholders, and collapses trailing slashes.
 */
function normaliseRoute(pathname) {
  // Strip query string and fragment
  const clean = pathname.split("?")[0].split("#")[0];
  return clean
    .replace(DYNAMIC_SEGMENT_RE, "/:id$1")
    .replace(/\/+$/, "") || "/";
}

/**
 * Express middleware factory.
 * Records duration, count, and error metrics for every completed request.
 */
function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;
    const route = normaliseRoute(req.route?.path || req.path || "unknown");
    const method = req.method;
    const status = String(res.statusCode);

    httpRequestsTotal.inc({ method, route, status });
    httpRequestDuration.observe({ method, route, status }, durationSec);

    if (res.statusCode >= 400) {
      httpRequestErrors.inc({ method, route, status });
    }
  });

  next();
}

module.exports = { metricsMiddleware, normaliseRoute };

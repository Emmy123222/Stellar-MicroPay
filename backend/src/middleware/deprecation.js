/**
 * src/middleware/deprecation.js
 * Express middleware attaching standard HTTP deprecation headers to unversioned API routes (#853).
 *
 * Implements RFC 8594 (Sunset header) and RFC draft-ietf-httpapi-deprecation-header.
 */

"use strict";

const DEFAULT_SUNSET_DATE = "Sun, 31 Dec 2028 23:59:59 GMT";

/**
 * Express middleware that adds deprecation headers to legacy unversioned /api/* endpoints.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function apiDeprecationHeader(req, res, next) {
  // If request is already hitting versioned path (/api/v1/*) or docs, skip adding deprecation headers
  if (req.originalUrl.startsWith("/api/v1/") || req.originalUrl.startsWith("/api/docs")) {
    return next();
  }

  // Calculate successor version URL
  const v1Path = req.originalUrl.replace(/^\/api\//, "/api/v1/");

  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", process.env.API_SUNSET_DATE || DEFAULT_SUNSET_DATE);
  res.setHeader("Link", `<${v1Path}>; rel="successor-version"`);

  next();
}

module.exports = { apiDeprecationHeader };

/**
 * src/middleware/csrf.js
 * Origin verification for cookie-authenticated, state-changing requests (#780).
 *
 * SameSite=Strict on the `jwt` cookie is useful defense-in-depth, but it isn't
 * sufficient on its own (some browsers/extensions relax SameSite handling, and
 * relying on a single header is fragile). This middleware adds an explicit
 * check: any request that would authenticate via the `jwt` cookie must also
 * present an Origin (or Referer, as a fallback for older/non-fetch clients)
 * header naming one of our own allowed origins.
 *
 * Non-browser / bearer-token flows are unaffected: a request carrying an
 * `Authorization: Bearer <token>` header never relies on the ambient cookie,
 * so it is not a CSRF target and skips this check entirely.
 */
"use strict";

const { parseAllowedOrigins } = require("../config/validateEnv");

function hasBearerToken(req) {
  const authHeader = req.headers.authorization;
  return typeof authHeader === "string" && authHeader.startsWith("Bearer ");
}

function originFromReferer(referer) {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Build the CSRF-guard middleware. Only rejects requests that would
 * authenticate via the httpOnly `jwt` cookie and whose Origin/Referer does
 * not match an allowed origin.
 *
 * @param {string} [allowedOriginsEnv] Defaults to process.env.ALLOWED_ORIGINS.
 */
function csrfOriginCheck(allowedOriginsEnv = process.env.ALLOWED_ORIGINS) {
  const { origins: allowedOrigins } = parseAllowedOrigins(allowedOriginsEnv);

  return function (req, res, next) {
    // Bearer-authenticated (non-browser) requests are not cookie-driven and
    // therefore cannot be forged cross-site — nothing to check.
    if (hasBearerToken(req)) {
      return next();
    }

    // No cookie present either — extractToken will fail auth downstream with
    // its own 401; this middleware only guards the cookie path.
    const hasCookieToken = typeof req.cookies?.jwt === "string";
    if (!hasCookieToken) {
      return next();
    }

    const origin = req.headers.origin || originFromReferer(req.headers.referer);

    if (!origin || !allowedOrigins.includes(origin)) {
      return res.status(403).json({
        error: "Forbidden: request origin is not allowed for cookie-authenticated requests",
      });
    }

    return next();
  };
}

module.exports = { csrfOriginCheck };

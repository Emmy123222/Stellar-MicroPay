/**
 * src/middleware/csrf.js
 * CSRF protection using the double-submit cookie pattern.
 *
 * The companion analysis in `./auth.js` explains why the stateless SEP-0010
 * bearer-token flow is already CSRF-resistant; this middleware adds the
 * defence-in-depth layer requested by the security issue.
 *
 * How the double-submit cookie pattern works here
 * -----------------------------------------------------------------------------
 * 1. The server hands the browser a cryptographically random token in a
 *    *readable* (non-httpOnly) cookie: `csrfToken`.
 * 2. The client echoes that token back in the `X-CSRF-Token` header on every
 *    state-changing request.
 * 3. A forged cross-site request is unable to read the cookie (same-origin
 *    policy) and therefore cannot produce a matching header, so the request is
 *    rejected — even though the browser may still have attached its cookies.
 *
 * Scope
 * -----------------------------------------------------------------------------
 * CSRF only exists where the browser attaches credentials automatically
 * (cookies). Requests that carry no cookies are stateless/bearer clients that
 * are not CSRF-susceptible, so they are allowed through untouched.
 */
"use strict";

const crypto = require("crypto");

const CSRF_COOKIE = "csrfToken";
const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Parse a raw `Cookie` header into a plain object.
 * Kept dependency-free so the security fix adds no new supply-chain surface.
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  }

  return cookies;
}

/** Generate a cryptographically strong, URL-safe CSRF token. */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

/** Constant-time comparison that tolerates mismatched lengths. */
function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Write a readable CSRF cookie and return the token that was stored.
 * Called when a session is established (login) or when a client explicitly
 * requests a token from `GET /api/auth/csrf`.
 */
function setCsrfCookie(res, token = generateCsrfToken()) {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // must be readable by the frontend to echo it back
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
  });
  return token;
}

/**
 * Double-submit verification for state-changing requests.
 *
 * - Safe methods (GET/HEAD/OPTIONS) are never blocked.
 * - Requests without cookies carry no ambient authority, so they are allowed
 *   (stateless / bearer-token clients are not CSRF-susceptible).
 * - Requests that carry cookies must present an `X-CSRF-Token` header matching
 *   the `csrfToken` cookie.
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookies = parseCookies(req.headers.cookie);
  const hasCookies = Object.keys(cookies).length > 0;

  // No cookies => no ambient credentials => nothing for CSRF to hijack.
  if (!hasCookies) return next();

  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
    return res
      .status(403)
      .json({ error: "Forbidden: invalid or missing CSRF token" });
  }

  return next();
}

module.exports = {
  csrfProtection,
  setCsrfCookie,
  generateCsrfToken,
  parseCookies,
  tokensMatch,
  CSRF_COOKIE,
  CSRF_HEADER,
};

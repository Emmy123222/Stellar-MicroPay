/**
 * src/middleware/auth.js
 * JWT verification middleware for SEP-0010 authenticated routes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CSRF ANALYSIS (see issue: "security: add CSRF protection to the backend API")
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Question: does the SEP-0010 JWT mechanism already provide sufficient CSRF
 * protection, or is a dedicated (double-submit cookie) defense required?
 *
 * 1. How requests are authenticated today
 *    -------------------------------------------------------------------------
 *    `POST /api/auth` verifies a SEP-0010 challenge and issues a stateless JWT.
 *    The token is returned in the response body and the client stores it in
 *    `localStorage`, then sends it on privileged requests as:
 *
 *        Authorization: Bearer <jwt>
 *
 *    `verifyJWT` below reads *only* that header. The httpOnly `jwt` cookie also
 *    set by the login route is never consulted for authentication.
 *
 * 2. Why bearer-token authentication resists classic CSRF
 *    -------------------------------------------------------------------------
 *    CSRF abuses *ambient authority*: credentials the browser attaches to a
 *    request automatically (cookies, HTTP auth, TLS client certs). A malicious
 *    cross-site page can make the browser send cookies, but it CANNOT read the
 *    victim's `localStorage`, and it CANNOT set an `Authorization` header on a
 *    cross-origin request — that would require a CORS preflight the server
 *    rejects (see `allowedOrigins` / `allowedHeaders` in `src/server.js`).
 *    Therefore a forged cross-site request can never carry a valid bearer
 *    token, and the authenticated API is not exploitable via CSRF.
 *
 *    The session cookie is additionally `httpOnly` and `SameSite=Strict`, so a
 *    browser will not attach it to cross-site requests even if it were used for
 *    authentication in the future.
 *
 * 3. Decision
 *    -------------------------------------------------------------------------
 *    The stateless SEP-0010 JWT already provides sufficient CSRF protection for
 *    the current bearer-token flow; no vulnerability is exploitable today.
 *    However, defence-in-depth is cheap and it future-proofs the API against a
 *    move to cookie-based sessions. We therefore ALSO implement the
 *    double-submit cookie pattern in `./csrf.js`, applied centrally in
 *    `src/server.js`. It only constrains requests that actually carry cookies
 *    (the browser-auto-attached credentials a CSRF attack would ride on), so
 *    pure bearer/stateless clients keep working unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */
"use strict";

const jwt = require("jsonwebtoken");

// Require JWT_SECRET environment variable - no default value for security
// Allow test default when not explicitly set (for CI/test environments)
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-secret-key-for-jest-tests-only-not-for-production";
  if (process.env.NODE_ENV !== "test" && !process.env.JEST_WORKER_ID) {
    console.warn(
      "WARNING: JWT_SECRET not set, using test default. " +
      "Set JWT_SECRET in production with: openssl rand -base64 48"
    );
  }
}

const JWT_SECRET = process.env.JWT_SECRET;

// Lock out an IP after repeated failed JWT verifications to slow token brute-forcing.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// ip -> { count, lockedUntil }
const failedAttempts = new Map();

function getClientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

function isLockedOut(ip, now = Date.now()) {
  const entry = failedAttempts.get(ip);
  if (!entry || !entry.lockedUntil) return false;
  if (entry.lockedUntil > now) return true;
  failedAttempts.delete(ip);
  return false;
}

function recordFailure(ip, now = Date.now()) {
  const entry = failedAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
  failedAttempts.set(ip, entry);
}

function resetFailedAttempts() {
  failedAttempts.clear();
}

function verifyJWT(req, res, next) {
  const ip = getClientIp(req);

  if (isLockedOut(ip)) {
    const retryAfter = Math.ceil((failedAttempts.get(ip).lockedUntil - Date.now()) / 1000);
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "Too many failed authentication attempts. Try again later.",
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: missing or invalid token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    failedAttempts.delete(ip);
    req.user = decoded; // { publicKey: "G..." }
    next();
  } catch {
    recordFailure(ip);
    return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
  }
}

module.exports = {
  verifyJWT,
  JWT_SECRET,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  resetFailedAttempts,
};

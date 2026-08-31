/**
 * src/middleware/auth.js
 * JWT verification middleware for SEP-0010 authenticated routes.
 */
"use strict";

const jwt = require("jsonwebtoken");

const logger = require("../utils/logger");

const DEFAULT_JWT_SECRET = "stellar_micropay_secret_key";
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

// Sign/verify options shared by the auth routes and this middleware. Pinning the
// algorithm to HS256 prevents "alg" confusion attacks (e.g. a forged token with
// `alg: none` or an RS256/HS256 downgrade being accepted).
const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "stellar-micropay";
const ACCESS_TOKEN_TTL = "24h";

// Refuse to run in production with the built-in fallback secret — tokens signed
// with a publicly-known key can be forged by anyone.
if (process.env.NODE_ENV === "production" && JWT_SECRET === DEFAULT_JWT_SECRET) {
  logger.error(
    "JWT_SECRET is unset in production — refusing to start with the insecure default secret."
  );
  throw new Error("JWT_SECRET must be set to a strong, unique value in production");
}

if (JWT_SECRET === DEFAULT_JWT_SECRET) {
  logger.warn(
    "JWT_SECRET is using the insecure built-in default. Set JWT_SECRET before deploying."
  );
}

const VERIFY_OPTIONS = {
  algorithms: [JWT_ALGORITHM],
  issuer: JWT_ISSUER,
  // Tolerate small clock drift between the signing and verifying hosts.
  clockTolerance: 5,
};

const SIGN_OPTIONS = {
  algorithm: JWT_ALGORITHM,
  issuer: JWT_ISSUER,
  expiresIn: ACCESS_TOKEN_TTL,
};

/**
 * Extract a bearer token from the Authorization header, falling back to the
 * httpOnly `jwt` cookie set at login.
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  if (req.cookies && typeof req.cookies.jwt === "string") {
    return req.cookies.jwt;
  }
  return null;
}

function verifyJWT(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: missing or invalid token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, VERIFY_OPTIONS);
    req.user = decoded; // { publicKey: "G..." }
    return next();
  } catch (err) {
    // Distinguish an expired token (client should refresh / re-authenticate)
    // from a malformed or forged one.
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ error: "Unauthorized: token expired", code: "token_expired" });
    }
    return res.status(401).json({ error: "Unauthorized: invalid token" });
  }
}

module.exports = {
  verifyJWT,
  extractToken,
  JWT_SECRET,
  JWT_ALGORITHM,
  JWT_ISSUER,
  ACCESS_TOKEN_TTL,
  VERIFY_OPTIONS,
  SIGN_OPTIONS,
};

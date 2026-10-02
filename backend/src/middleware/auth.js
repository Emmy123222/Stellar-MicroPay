/**
 * src/middleware/auth.js
 * JWT verification middleware for SEP-0010 authenticated routes.
 */
"use strict";

const jwt = require("jsonwebtoken");

// Require JWT_SECRET environment variable - no default value for security
if (!process.env.JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is not set. " +
    "Generate a secure secret with: openssl rand -base64 48"
  );
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

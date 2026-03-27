/**
 * src/middleware/auth.js
 * JWT verification middleware for SEP-0010 authenticated routes.
 */
"use strict";

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "stellar_micropay_secret_key";

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: missing or invalid token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { publicKey: "G..." }
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
  }
}

module.exports = { verifyJWT, JWT_SECRET };

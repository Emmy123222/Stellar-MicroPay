/**
 * src/routes/accounts.js
 * Account lookup and balance endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter, sensitiveLimiter } = require("../middleware/rateLimit");
const { sanitizePublicKey, sanitizeUsername } = require("../middleware/sanitization");
const { verifyJWT } = require("../middleware/auth");
const accountController = require("../controllers/accountController");

/**
 * Restrict account-data routes to the authenticated account holder (#278).
 * Runs after verifyJWT (which sets req.user.publicKey from the SEP-10 JWT).
 */
function requireOwnAccount(req, res, next) {
  if (req.user?.publicKey !== req.params.publicKey) {
    return res
      .status(403)
      .json({ error: "Forbidden: you may only access your own account data" });
  }
  next();
}

/**
 * GET /api/accounts/resolve/:username
 * Resolve a username to a Stellar public key.
 * Must be registered before /:publicKey or Express matches it as a key.
 */
router.get("/resolve/:username", sensitiveLimiter, sanitizeUsername, accountController.resolveUsername);

/**
 * GET /api/accounts/:publicKey
 * Fetch account info and balances from Horizon.
 */
router.get("/:publicKey", sensitiveLimiter, verifyJWT, sanitizePublicKey, requireOwnAccount, accountController.getAccount);

/**
 * GET /api/accounts/:publicKey/balance
 * Fetch just the XLM balance for an account.
 */
router.get("/:publicKey/balance", sensitiveLimiter, verifyJWT, sanitizePublicKey, requireOwnAccount, accountController.getBalance);

/**
 * POST /api/accounts/register
 * Register a new username with a public key.
 */
router.post("/register", strictLimiter, accountController.registerUsername);

module.exports = router;

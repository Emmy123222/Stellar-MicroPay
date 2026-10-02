/**
 * src/routes/accounts.js
 * Account lookup and balance endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { validatePublicKey, sanitizeUsername } = require("../middleware/sanitization");
const accountController = require("../controllers/accountController");

/**
 * GET /api/accounts/resolve/:username
 * Resolve a username to a Stellar public key.
 * Must be registered before /:publicKey or Express matches it as a key.
 */
router.get("/resolve/:username", strictLimiter, sanitizeUsername, accountController.resolveUsername);

/**
 * GET /api/accounts/:publicKey/has-usdc-trustline
 * Check whether an account has a USDC trustline.
 * Must be registered before /:publicKey or Express matches it as a key.
 */
router.get(
  "/:publicKey/has-usdc-trustline",
  strictLimiter,
  validatePublicKey(),
  accountController.hasUSDCTrustline
);

/**
 * GET /api/accounts/:publicKey
 * Fetch account info and balances from Horizon.
 */
router.get("/:publicKey", strictLimiter, validatePublicKey(), accountController.getAccount);

/**
 * GET /api/accounts/:publicKey/balance
 * Fetch just the XLM balance for an account.
 */
router.get("/:publicKey/balance", strictLimiter, validatePublicKey(), accountController.getBalance);

/**
 * GET /api/accounts/:publicKey/assets
 * List all non-native asset trustlines (code, issuer, balance, limit) (#1065).
 * Requires a valid SEP-0010 JWT.
 */
router.get("/:publicKey/assets", strictLimiter, verifyJWT, sanitizePublicKey, accountController.getAccountAssets);

/**
 * POST /api/accounts/register
 * Register a new username with a public key.
 */
router.post("/register", strictLimiter, accountController.registerUsername);

module.exports = router;

/**
 * src/controllers/accountController.js
 * Handles account-related requests.
 */

"use strict";

const stellarService = require("../services/stellarService");
const usernameService = require("../services/usernameService");
const logger = require("../utils/logger");

/**
 * @typedef {object} AccountBalanceEntry
 * @property {string} assetCode
 * @property {string} balance
 * @property {string} [assetIssuer]
 * @property {string} asset_type
 */

/**
 * @typedef {object} AccountResponse
 * @property {string} publicKey
 * @property {string} sequence
 * @property {AccountBalanceEntry[]} balances
 * @property {number} subentryCount
 */

/**
 * GET /api/accounts/:publicKey
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: AccountResponse }`
 */
async function getAccount(req, res, next) {
  try {
    const { publicKey } = req.params;
    const account = await stellarService.getAccount(publicKey);
    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/accounts/:publicKey/balance
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: { publicKey: string, xlm: string } }`
 */
async function getBalance(req, res, next) {
  try {
    const { publicKey } = req.params;
    const balance = await stellarService.getXLMBalance(publicKey);
    res.json({ success: true, data: { publicKey, xlm: balance } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/accounts/register
 * Register a new username with a public key.
 *
 * @param {object} req - Express request
 * @param {object} req.body
 * @param {string} req.body.username - Desired username (3-20 alphanumeric chars)
 * @param {string} req.body.publicKey - Stellar public key (G...)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} 201 JSON: `{ success: true, data: { username: string, publicKey: string }, message: string }`,
 *   or 400 JSON: `{ error: string }` when username/publicKey are missing
 */
async function registerUsername(req, res, next) {
  try {
    const { username, publicKey } = req.body;

    if (!username || !publicKey) {
      logger.warn({ event: "username_registration_rejected", reason: "missing_fields" }, "Username registration rejected");
      return res.status(400).json({
        success: false,
        error: "Username and public key are required",
      });
    }

    if (!req.user?.publicKey || req.user.publicKey !== publicKey) {
      logger.warn(
        { event: "username_registration_rejected", subject: req.user?.publicKey, requestedKey: publicKey },
        "Username registration rejected: wallet ownership mismatch",
      );
      return res.status(403).json({ error: "Forbidden: wallet ownership proof does not match public key" });
    }

    const result = usernameService.registerUsername(username, publicKey);
    logger.info(
      { event: "username_registered", username, publicKey: req.user.publicKey },
      "Username registered",
    );
    res.status(201).json({
      success: true,
      data: result,
      message: "Username registered successfully",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/accounts/resolve/:username
 * Resolve a username to its associated public key.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.username - Registered username to resolve
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: { username: string, publicKey: string } }`,
 *   or 501 JSON: `{ success: false, error: string }` for the reserved "alice" username
 */
async function resolveUsername(req, res, next) {
  try {
    const { username } = req.params;

    if (username.toLowerCase() === 'alice') {
      return res.status(501).json({
        success: false,
        error: "Not Implemented",
      });
    }

    const result = usernameService.resolveUsername(username);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAccount, getBalance, registerUsername, resolveUsername };

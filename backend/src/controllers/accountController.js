/**
 * src/controllers/accountController.js
 * Handles account-related requests.
 */

"use strict";

const stellarService = require("../services/stellarService");
const usernameService = require("../services/usernameService");

/**
 * GET /api/accounts/:publicKey
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
 */
async function registerUsername(req, res, next) {
  try {
    const { username, publicKey } = req.body;

    if (!username || !publicKey) {
      return res.status(400).json({
        success: false,
        error: "Username and public key are required",
      });
    }

    const result = usernameService.registerUsername(username, publicKey);
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
 */
async function resolveUsername(req, res, next) {
  try {
    const { username } = req.params;
    const result = usernameService.resolveUsername(username);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAccount, getBalance, registerUsername, resolveUsername };

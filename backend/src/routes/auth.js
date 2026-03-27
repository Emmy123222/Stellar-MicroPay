/**
 * src/routes/auth.js
 * SEP-0010 Stellar Web Authentication endpoints.
 *
 * GET  /api/auth?account=G... → returns a challenge transaction
 * POST /api/auth              → verifies signed challenge, returns JWT
 */
"use strict";

const express = require("express");
const jwt     = require("jsonwebtoken");
const { Utils, Keypair } = require("@stellar/stellar-sdk");
const { JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

const HOME_DOMAIN = process.env.HOME_DOMAIN || "localhost:4000";
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";

// Cache the server keypair — regenerated only on cold start.
let cachedServerKeypair = null;
function getServerKeypair() {
  if (!cachedServerKeypair) {
    const secret = process.env.SERVER_PRIVATE_KEY || Keypair.random().secret();
    cachedServerKeypair = Keypair.fromSecret(secret);
  }
  return cachedServerKeypair;
}

// GET /api/auth?account=G... — issue a SEP-0010 challenge transaction
router.get("/", (req, res) => {
  const { account } = req.query;
  if (!account) {
    return res.status(400).json({ error: "Missing account query parameter" });
  }

  try {
    const keypair   = getServerKeypair();
    const challenge = Utils.buildChallengeTx(
      keypair,
      account,
      HOME_DOMAIN,
      300, // 5-minute validity window
      NETWORK_PASSPHRASE
    );
    res.json({ transaction: challenge, networkPassphrase: NETWORK_PASSPHRASE });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/auth — verify signed challenge and issue JWT
router.post("/", (req, res) => {
  const { transaction } = req.body;
  if (!transaction) {
    return res.status(400).json({ error: "Missing transaction in request body" });
  }

  try {
    const keypair   = getServerKeypair();
    const accountId = Utils.verifyChallengeTx(
      transaction,
      keypair.publicKey(),
      NETWORK_PASSPHRASE,
      HOME_DOMAIN,
      ""
    );

    const token = jwt.sign({ publicKey: accountId }, JWT_SECRET, { expiresIn: "24h" });

    res.cookie("jwt", token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge:   24 * 60 * 60 * 1000,
    });

    res.json({ success: true, token });
  } catch (e) {
    res.status(401).json({ error: "Unauthorized: " + e.message });
  }
});

module.exports = router;

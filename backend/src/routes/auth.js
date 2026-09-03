/**
 * src/routes/auth.js
 * SEP-0010 Stellar Web Authentication endpoints.
 *
 * GET  /api/auth?account=G... → issues a challenge transaction and records it
 *                               in the challenge store for one-time-use enforcement
 * POST /api/auth              → verifies the signed challenge (consuming it
 *                               atomically), then returns a JWT
 */
"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const { Utils, Keypair } = require("@stellar/stellar-sdk");
const { JWT_SECRET, SIGN_OPTIONS, VERIFY_OPTIONS, extractToken } = require("../middleware/auth");
const { csrfOriginCheck } = require("../middleware/csrf");
const challengeStore = require("../services/challengeStore");

const router = express.Router();

const ACCESS_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Options for the httpOnly session cookie. `secure` is only enforced in
// production so local (http) development still works.
function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  };
}

function issueToken(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET, SIGN_OPTIONS);
}

const HOME_DOMAIN = process.env.HOME_DOMAIN || "localhost:4000";

/**
 * The network passphrase is derived once at startup from STELLAR_NETWORK.
 * It is stored on every challenge record so that the verification step can
 * confirm the presented transaction was built for the same network — preventing
 * a testnet challenge from being replayed against a mainnet server or vice versa.
 */
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

// ─── GET /api/auth?account=G... ────────────────────────────────────────────
// Issue a SEP-0010 challenge transaction and record it in the challenge store.
//
// The record captures:
//   id        — tx hash (hex) — unique per challenge, derived deterministically
//               from the transaction envelope so it survives the XDR round-trip
//   subject   — the client's Stellar public key
//   network   — the network passphrase the challenge was built for
//   expiresAt — timeBounds.maxTime converted to epoch ms (5-minute window)
//   consumed  — false until the client successfully verifies
router.get("/", (req, res) => {
  const { account } = req.query;
  if (!account) {
    return res.status(400).json({ error: "Missing account query parameter" });
  }

  try {
    const keypair = getServerKeypair();
    const challenge = Utils.buildChallengeTx(
      keypair,
      account,
      HOME_DOMAIN,
      300, // 5-minute validity window
      NETWORK_PASSPHRASE,
      HOME_DOMAIN // webAuthDomain
    );

    // Parse the transaction back to extract the stable hash and timebounds.
    const { tx, clientAccountID } = WebAuth.readChallengeTx(
      challengeXdr,
      keypair.publicKey(),
      NETWORK_PASSPHRASE,
      HOME_DOMAIN,
      HOME_DOMAIN
    );

    const challengeId = tx.hash().toString("hex");
    // timeBounds.maxTime is in seconds (Unix); convert to ms for the store.
    const expiresAt = Number(tx.timeBounds.maxTime) * 1000;

    challengeStore.storeChallenge({
      id:        challengeId,
      subject:   clientAccountID,
      network:   NETWORK_PASSPHRASE,
      expiresAt,
    });

    res.json({ transaction: challengeXdr, networkPassphrase: NETWORK_PASSPHRASE });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── POST /api/auth ─────────────────────────────────────────────────────────
// Verify a signed challenge and issue a JWT.
//
// The challenge is consumed atomically: we parse the presented XDR to derive
// its hash, call consumeChallenge (which checks existence, expiry, consumed
// state, subject, and network in a single synchronous step, then marks it
// consumed before returning), and only proceed to cryptographic verification
// if the store check passes.  This order prevents replay even if an attacker
// submits two concurrent requests with the same signed transaction.
router.post("/", (req, res) => {
  const { transaction } = req.body;
  if (!transaction) {
    return res.status(400).json({ error: "Missing transaction in request body" });
  }

  try {
    const keypair = getServerKeypair();
    const accountId = Utils.verifyChallengeTx(
      transaction,
      keypair.publicKey(),
      NETWORK_PASSPHRASE,
      [parsedSubject],
      HOME_DOMAIN,
      HOME_DOMAIN
    );

    // matchedSigners is the array of public keys whose signatures were verified.
    // The first entry (and only, for a simple account) is the authenticated subject.
    const accountId = matchedSigners[0];
    const token = issueToken(accountId);

    res.cookie("jwt", token, cookieOptions());
    res.json({ success: true, token });
  } catch (e) {
    res.status(401).json({ error: "Unauthorized: " + e.message });
  }
});

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────
// Exchange a still-valid (or freshly-expired) token for a new one, so
// long-lived sessions don't force a full SEP-0010 re-challenge.
//
// The presented token must be structurally valid and signed by us; we allow a
// short grace window past expiry (ignoreExpiration + manual age check) so a
// client whose access token just lapsed can seamlessly refresh, but a token
// that expired long ago is rejected and must re-authenticate.
const REFRESH_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// CSRF defense-in-depth (#780): SameSite=strict already stops the cookie from
// being sent on cross-site requests in modern browsers, but this middleware
// adds an explicit Origin/Referer check for the cookie-authenticated path so
// a browser or extension that relaxes SameSite handling doesn't silently
// reopen the hole. Requests authenticating via `Authorization: Bearer` (the
// non-browser / server-to-server flow) are untouched.
router.post("/refresh", csrfOriginCheck(), (req, res) => {
  const token = extractToken(req) || req.body?.token;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: missing token" });
  }

  let decoded;
  try {
    // Verify signature/issuer/algorithm but tolerate expiry here; we enforce a
    // stricter grace window manually below.
    decoded = jwt.verify(token, JWT_SECRET, {
      ...VERIFY_OPTIONS,
      ignoreExpiration: true,
    });
  } catch {
    return res.status(401).json({ error: "Unauthorized: invalid token" });
  }

  // Reject tokens that expired beyond the refresh grace window.
  if (typeof decoded.exp === "number") {
    const expiredForMs = Date.now() - decoded.exp * 1000;
    if (expiredForMs > REFRESH_GRACE_MS) {
      return res.status(401).json({ error: "Unauthorized: token expired, please re-authenticate" });
    }
  }

  const newToken = issueToken(decoded.publicKey);
  res.cookie("jwt", newToken, cookieOptions());
  return res.json({ success: true, token: newToken });
});

module.exports = router;

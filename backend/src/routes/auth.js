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
const {
  JWT_SECRET,
  SIGN_OPTIONS,
  VERIFY_OPTIONS,
  extractToken,
  verifyJWT,
} = require("../middleware/auth");
const { csrfOriginCheck } = require("../middleware/csrf");
const tokenFamilyStore = require("../services/tokenFamilyStore");

const router = express.Router();

const ACCESS_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Options for the httpOnly session cookie. `secure` is only enforced in
// production so local (http) development still works.
function cookieOptions() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge:   ACCESS_TOKEN_MAX_AGE_MS,
  };
}

// Every issued token belongs to a rotation family (`fam`) and carries a unique
// id (`jti`). Refresh rotates `jti` within the family; presenting a `jti` that
// isn't the family's current one means an already-rotated token was reused.
function issueToken(publicKey, { familyId, jti }) {
  return jwt.sign({ publicKey, fam: familyId }, JWT_SECRET, {
    ...SIGN_OPTIONS,
    jwtid: jti,
  });
}

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

    const { familyId, jti } = tokenFamilyStore.createFamily(accountId);
    const token = issueToken(accountId, { familyId, jti });

    res.cookie("jwt", token, cookieOptions());

    res.json({ success: true, token });
  } catch (e) {
    res.status(401).json({ error: "Unauthorized: " + e.message });
  }
});

// POST /api/auth/refresh — exchange a still-valid (or freshly-expired) token for
// a new one, so long-lived sessions don't force a full SEP-0010 re-challenge.
//
// The presented token must be structurally valid and signed by us; we allow a
// short grace window past expiry (ignoreExpiration + manual age check) so a
// client whose access token just lapsed can seamlessly refresh, but a token that
// expired long ago is rejected and must re-authenticate.
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
      return res
        .status(401)
        .json({ error: "Unauthorized: token expired, please re-authenticate" });
    }
  }

  // Tokens issued before token-family tracking existed carry no `fam`/`jti`
  // claims — there's no family to validate against, so they can't be safely
  // rotated and must re-authenticate instead.
  const familyId = decoded.fam;
  const jti = decoded.jti;
  if (!familyId || !jti) {
    return res
      .status(401)
      .json({ error: "Unauthorized: token missing family, please re-authenticate" });
  }

  const family = tokenFamilyStore.getFamily(familyId);
  if (!family || family.revoked) {
    return res
      .status(401)
      .json({ error: "Unauthorized: session revoked, please re-authenticate" });
  }

  if (family.currentJti !== jti) {
    // A previously-rotated token was presented again — a strong signal of
    // refresh-token theft. Kill the entire family, not just this token.
    tokenFamilyStore.revokeFamily(familyId);
    return res.status(401).json({
      error: "Unauthorized: token reuse detected, session revoked",
      code: "token_reuse_detected",
    });
  }

  const newJti = tokenFamilyStore.rotateFamily(familyId);
  const newToken = issueToken(decoded.publicKey, { familyId, jti: newJti });
  res.cookie("jwt", newToken, cookieOptions());
  return res.json({ success: true, token: newToken });
});

// POST /api/auth/logout-all — revoke every active token family for the
// authenticated user ("log out of all devices"). Subsequent refresh attempts
// with any of that user's tokens will fail.
router.post("/logout-all", verifyJWT, (req, res) => {
  const revokedCount = tokenFamilyStore.revokeAllFamiliesForUser(req.user.publicKey);
  const { maxAge, ...clearOptions } = cookieOptions();
  res.clearCookie("jwt", clearOptions);
  return res.json({ success: true, revokedFamilies: revokedCount });
});

module.exports = router;

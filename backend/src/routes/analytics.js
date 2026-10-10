/**
 * src/routes/analytics.js
 * Analytics endpoints for transaction volume insights.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { verifyJWT } = require("../middleware/auth");
const { validatePublicKey, sanitizePublicKey } = require("../middleware/sanitization");
const analyticsController = require("../controllers/analyticsController");

function getAdminPublicKeys() {
  return (process.env.ADMIN_PUBLIC_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function requireAdmin(req, res, next) {
  const adminPublicKeys = getAdminPublicKeys();
  if (adminPublicKeys.length === 0) {
    return res.status(403).json({ error: "Forbidden: no admin accounts configured" });
  }
  if (!req.user || !adminPublicKeys.includes(req.user.publicKey)) {
    return res.status(403).json({ error: "Forbidden: admin access required" });
  }
  next();
}

/**
 * @swagger
 * /api/analytics/{publicKey}/summary:
 *   get:
 *     tags: [Analytics]
 *     summary: Get payment summary for an account
 *     description: >-
 *       Aggregates the account's most recent payments (up to 200, fetched from
 *       Horizon) into total sent/received XLM, unique counterparties, average
 *       transaction size, and total transaction count. Results are cached
 *       in-memory for 5 minutes.
 *     parameters:
 *       - name: publicKey
 *         in: path
 *         required: true
 *         description: Stellar public key of the account to summarize.
 *         schema:
 *           type: string
 *           pattern: ^G[A-Z0-9]{55}$
 *     responses:
 *       "200":
 *         description: Analytics summary for the account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AnalyticsSummary'
 *       "400":
 *         description: Invalid Stellar public key format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       "429":
 *         description: >-
 *           Rate limit exceeded — the strict limiter allows 20 requests per
 *           minute per IP.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  "/:publicKey/summary",
  strictLimiter,
  validatePublicKey(),
  analyticsController.getSummary,
);

/**
 * @swagger
 * /api/analytics/{publicKey}/top-recipients:
 *   get:
 *     tags: [Analytics]
 *     summary: Get top payment recipients
 *     description: >-
 *       Returns the 5 addresses that received the most XLM from this account
 *       (sent payments only, up to 200 recent payments), sorted descending by
 *       total sent. Results are cached in-memory for 5 minutes.
 *     parameters:
 *       - name: publicKey
 *         in: path
 *         required: true
 *         description: Stellar public key of the sending account.
 *         schema:
 *           type: string
 *           pattern: ^G[A-Z0-9]{55}$
 *     responses:
 *       "200":
 *         description: Top recipients by total XLM sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     publicKey:
 *                       type: string
 *                     topRecipients:
 *                       type: array
 *                       description: Up to 5 recipients, highest total first.
 *                       items:
 *                         $ref: '#/components/schemas/TopRecipient'
 *                     count:
 *                       type: integer
 *                       description: Number of recipients returned.
 *       "400":
 *         description: Invalid Stellar public key format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       "429":
 *         description: >-
 *           Rate limit exceeded — the strict limiter allows 20 requests per
 *           minute per IP.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  "/:publicKey/top-recipients",
  strictLimiter,
  validatePublicKey(),
  analyticsController.getTopRecipients,
);

/**
 * @swagger
 * /api/analytics/{publicKey}/activity:
 *   get:
 *     tags: [Analytics]
 *     summary: Get payment activity by day of week
 *     description: >-
 *       Counts the account's payments per day of week (Sunday through Saturday,
 *       UTC, up to 200 recent payments). Every day of the week is always
 *       present, including days with zero transactions. Results are cached
 *       in-memory for 5 minutes.
 *     parameters:
 *       - name: publicKey
 *         in: path
 *         required: true
 *         description: Stellar public key of the account.
 *         schema:
 *           type: string
 *           pattern: ^G[A-Z0-9]{55}$
 *     responses:
 *       "200":
 *         description: Payment counts for all 7 days of the week
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     publicKey:
 *                       type: string
 *                     activityByDay:
 *                       type: array
 *                       description: One entry per day, Sunday first.
 *                       items:
 *                         $ref: '#/components/schemas/ActivityDay'
 *       "400":
 *         description: Invalid Stellar public key format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       "429":
 *         description: >-
 *           Rate limit exceeded — the strict limiter allows 20 requests per
 *           minute per IP.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  "/:publicKey/activity",
  strictLimiter,
  validatePublicKey(),
  analyticsController.getActivityByDay,
);

/**
 * @swagger
 * /api/analytics/cache/{publicKey}:
 *   delete:
 *     tags: [Analytics]
 *     summary: Force-invalidate cached analytics for an account (admin only)
 *     description: >-
 *       Requires a valid SEP-0010 JWT. The JWT public key must be listed in
 *       ADMIN_PUBLIC_KEYS. Removes all cached analytics entries for the target
 *       account so the next request fetches fresh data from Horizon.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: publicKey
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           pattern: ^G[A-Z0-9]{55}$
 *     responses:
 *       "200":
 *         description: Cache entries invalidated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     publicKey:
 *                       type: string
 *                     invalidated:
 *                       type: integer
 *       "401":
 *         description: Missing or invalid JWT
 *       "403":
 *         description: Caller is not an admin account
 */
router.delete(
  "/cache/:publicKey",
  verifyJWT,
  requireAdmin,
  sanitizePublicKey,
  analyticsController.invalidateCache,
);

module.exports = router;
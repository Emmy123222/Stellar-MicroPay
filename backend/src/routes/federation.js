/**
 * src/routes/federation.js
 * Federation endpoints per SEP-0002.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const federationController = require("../controllers/federationController");

/**
 * @swagger
 * /federation:
 *   get:
 *     tags: [Federation]
 *     summary: SEP-0002 federation endpoint
 *     description: >-
 *       Resolves a Stellar address to an account ID (`type=name`) or an account ID
 *       to a Stellar address (`type=id`), per SEP-0002. Queries matching the local
 *       federation domain (`DOMAIN`, default `stellarmicropay.com`) are answered
 *       from the local username registry. Queries for other domains are forwarded
 *       to the federation server advertised by that domain's `stellar.toml`, and
 *       the external server's response body is returned unchanged (so it may
 *       contain additional SEP-0002 fields such as `memo`).
 *     parameters:
 *       - name: q
 *         in: query
 *         required: true
 *         description: >-
 *           Federation query: `user*domain` when `type=name`, or a Stellar public
 *           key when `type=id`.
 *         schema:
 *           type: string
 *           example: alice*stellarmicropay.com
 *       - name: type
 *         in: query
 *         required: true
 *         description: Resolution direction.
 *         schema:
 *           type: string
 *           enum: [name, id]
 *     responses:
 *       "200":
 *         description: >-
 *           Federation record for the query. `type=name` returns
 *           `stellar_address` and `account_id`; `type=id` returns
 *           `stellar_address` only. Queries for external domains return the
 *           external federation server's response body unchanged, which may
 *           contain additional SEP-0002 fields such as `memo`.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stellar_address:
 *                   type: string
 *                   description: "`username*domain` federated address"
 *                   example: alice*stellarmicropay.com
 *                 account_id:
 *                   type: string
 *                   description: >-
 *                     Stellar public key of the account (present for
 *                     `type=name` local lookups).
 *                   example: GABC...XYZ
 *       "400":
 *         description: >-
 *           Missing `q` or `type`, `type` other than `name` or `id`, or a
 *           malformed stellar address.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       "404":
 *         description: >-
 *           Username or account ID not found, or the external federation server
 *           returned 404 for a forwarded query.
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
router.get("/", strictLimiter, federationController.resolveFederation);

module.exports = router;

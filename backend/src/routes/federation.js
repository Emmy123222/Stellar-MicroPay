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
 *       to a Stellar address (`type=id`), per SEP-0002. Queries for local federation
 *       domains are answered from the local username registry. Queries for other
 *       domains are forwarded to the federation server advertised by that domain's
 *       `stellar.toml`, and the external server's response body is returned
 *       unchanged (so it may contain additional SEP-0002 fields such as `memo`).
 *     parameters:
 *       - name: q
 *         in: query
 *         required: true
 *         description: >-
 *           Federation query: `user*domain` when `type=name`, or a Stellar public
 *           key when `type=id`.
 *         schema:
 *           type: string
 *           example: alice*stellarmicropay.io
 *       - name: type
 *         in: query
 *         required: true
 *         description: Resolution direction.
 *         schema:
 *           type: string
 *           enum: [name, id]
 *     responses:
 *       "200":
 *         description: Federation record for the query
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stellar_address:
 *                   type: string
 *                   description: "`username*domain` federated address"
 *                   example: alice*stellarmicropay.io
 *                 account_id:
 *                   type: string
 *                   description: Stellar public key of the account
 *                   example: GABC...XYZ
 *       "400":
 *         description: >-
 *           Missing or non-string `q`/`type`, `type` other than `name` or `id`,
 *           or a malformed stellar address.
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

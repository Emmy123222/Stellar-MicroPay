/**
 * src/routes/turrets.js
 * Turrets txFunctions API routes.
 */

"use strict";

const express = require("express");
const { strictLimiter } = require("../middleware/rateLimit");
const controller = require("../controllers/turretsController");

const router = express.Router();

/**
 * @swagger
 * /api/turrets:
 *   get:
 *     tags: [Turrets]
 *     summary: List deployed txFunctions
 *     description: >-
 *       Returns all txFunction deployments, optionally filtered by owner.
 *       Deployments are held in memory, so they do not survive a server
 *       restart.
 *     parameters:
 *       - name: ownerPublicKey
 *         in: query
 *         required: false
 *         description: >-
 *           When provided, only deployments owned by this Stellar public key
 *           are returned.
 *         schema:
 *           type: string
 *           pattern: ^G[A-Z0-9]{55}$
 *     responses:
 *       "200":
 *         description: List of txFunction deployments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TxFunctionDeployment'
 *       "400":
 *         description: Invalid `ownerPublicKey` format
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
router.get("/", strictLimiter, controller.list);

/**
 * @swagger
 * /api/turrets/challenge:
 *   post:
 *     tags: [Turrets]
 *     summary: Get a signing challenge for deploying a txFunction
 *     description: >-
 *       Normalizes the requested txFunction configuration, derives the
 *       deployment hash, and builds a ManageData challenge transaction the
 *       owner account must sign before deploying.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ownerPublicKey, type]
 *             properties:
 *               ownerPublicKey:
 *                 type: string
 *                 pattern: ^G[A-Z0-9]{55}$
 *                 description: Stellar public key that will own the deployment.
 *               type:
 *                 type: string
 *                 enum: [dca, stop_loss]
 *                 description: txFunction type to configure.
 *               config:
 *                 type: object
 *                 description: >-
 *                   Type-specific configuration. DCA accepts `intervalMinutes`
 *                   (>= 1), `amountQuote` (> 0), `quoteAssetCode`,
 *                   `quoteAssetIssuer`. Stop-loss accepts `thresholdPrice`
 *                   (> 0), `amountSell` (> 0), `sellAssetCode`,
 *                   `sellAssetIssuer`, `cooldownMinutes` (>= 1).
 *     responses:
 *       "200":
 *         description: Challenge to sign
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TurretsChallenge'
 *       "400":
 *         description: >-
 *           Invalid `ownerPublicKey`, unsupported txFunction type, invalid
 *           configuration values, or malformed JSON body.
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
router.post("/challenge", strictLimiter, controller.createChallenge);

/**
 * @swagger
 * /api/turrets/deploy:
 *   post:
 *     tags: [Turrets]
 *     summary: Deploy a signed txFunction
 *     description: >-
 *       Verifies the signed challenge, re-derives the configuration hash to
 *       prevent tampering, registers the deployment, and starts the evaluation
 *       runner for it.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ownerPublicKey, type, deploymentHash, signedChallengeXDR]
 *             properties:
 *               ownerPublicKey:
 *                 type: string
 *                 pattern: ^G[A-Z0-9]{55}$
 *                 description: Stellar public key that owns the deployment.
 *               type:
 *                 type: string
 *                 enum: [dca, stop_loss]
 *               config:
 *                 type: object
 *                 description: Type-specific configuration (see the challenge endpoint).
 *               deploymentHash:
 *                 type: string
 *                 description: Hash returned by the challenge endpoint.
 *               signedChallengeXDR:
 *                 type: string
 *                 description: Challenge transaction signed by the owner account.
 *     responses:
 *       "201":
 *         description: txFunction deployed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TxFunctionDeployment'
 *       "400":
 *         description: >-
 *           Invalid `ownerPublicKey`, configuration hash mismatch, unsupported
 *           txFunction type, invalid configuration or asset issuer, signed
 *           challenge source account mismatch, or malformed JSON body.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       "401":
 *         description: Signed challenge was not signed by the owner account
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
router.post("/deploy", strictLimiter, controller.deploy);

/**
 * @swagger
 * /api/turrets/dca:
 *   post:
 *     tags: [Turrets]
 *     summary: Create a scheduled (DCA) payment deployment
 *     description: >-
 *       Creates a turrets deployment that repeatedly converts the configured
 *       quote asset for the recipient on a fixed interval. The deployment is
 *       created in the `active` state and starts running immediately.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ownerPublicKey, recipient, amount]
 *             properties:
 *               ownerPublicKey:
 *                 type: string
 *                 description: Stellar public key that owns the deployment.
 *               recipient:
 *                 type: string
 *                 description: Stellar public key receiving each scheduled payment.
 *               amount:
 *                 type: number
 *                 description: Amount converted per interval; must be greater than 0.
 *               asset:
 *                 type: string
 *                 default: XLM
 *                 description: Quote asset code (defaults to `XLM`).
 *               assetIssuer:
 *                 type: string
 *                 nullable: true
 *                 description: Issuer of the quote asset when it is not `XLM`.
 *               frequency:
 *                 type: string
 *                 enum: [daily, weekly, monthly]
 *                 default: daily
 *                 description: How often each scheduled payment runs.
 *     responses:
 *       "201":
 *         description: Scheduled payment deployment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TxFunctionDeployment'
 *       "400":
 *         description: >-
 *           Invalid public key, non-positive amount, or unsupported frequency
 *           (must be `daily`, `weekly`, or `monthly`)
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
router.post("/dca", strictLimiter, controller.createDca);

/**
 * @swagger
 * /api/turrets/{id}:
 *   get:
 *     tags: [Turrets]
 *     summary: Get a txFunction deployment
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Deployment ID (UUID returned on deploy).
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       "200":
 *         description: The deployment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TxFunctionDeployment'
 *       "404":
 *         description: txFunction not found
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
router.get("/:id", strictLimiter, controller.getOne);

/**
 * @swagger
 * /api/turrets/{id}/history:
 *   get:
 *     tags: [Turrets]
 *     summary: Get execution history for a deployment
 *     description: >-
 *       Returns execution log entries for the deployment (status, message, and
 *       any result payload), most recent first.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Deployment ID (UUID returned on deploy).
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       "200":
 *         description: Execution log entries, most recent first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ExecutionLogEntry'
 *       "404":
 *         description: txFunction not found
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
router.get("/:id/history", strictLimiter, controller.getHistory);

/**
 * @swagger
 * /api/turrets/{id}/pause:
 *   post:
 *     tags: [Turrets]
 *     summary: Pause a txFunction deployment
 *     description: >-
 *       Sets the deployment status to `paused`; paused deployments are not
 *       evaluated by the runner until resumed.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Deployment ID (UUID returned on deploy).
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       "200":
 *         description: Updated deployment with status `paused`
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TxFunctionDeployment'
 *       "404":
 *         description: txFunction not found
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
router.post("/:id/pause", strictLimiter, controller.pause);

/**
 * @swagger
 * /api/turrets/{id}/pause:
 *   patch:
 *     tags: [Turrets]
 *     summary: Pause a txFunction deployment (PATCH variant)
 *     description: >-
 *       Identical to `POST /api/turrets/{id}/pause`: sets the deployment
 *       status to `paused`; paused deployments are not evaluated by the
 *       runner until resumed.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Deployment ID (UUID returned on deploy).
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       "200":
 *         description: Updated deployment with status `paused`
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TxFunctionDeployment'
 *       "404":
 *         description: txFunction not found
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
router.patch("/:id/pause", strictLimiter, controller.pause);

/**
 * @swagger
 * /api/turrets/{id}/resume:
 *   post:
 *     tags: [Turrets]
 *     summary: Resume a paused txFunction deployment
 *     description: >-
 *       Sets the deployment status back to `active` so the runner evaluates it
 *       again.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Deployment ID (UUID returned on deploy).
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       "200":
 *         description: Updated deployment with status `active`
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TxFunctionDeployment'
 *       "404":
 *         description: txFunction not found
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
router.post("/:id/resume", strictLimiter, controller.resume);

/**
 * @swagger
 * /api/turrets/{id}:
 *   delete:
 *     tags: [Turrets]
 *     summary: Cancel (delete) a txFunction deployment
 *     description: >-
 *       Removes the deployment entirely and logs a `cancelled` execution
 *       entry. Paused or active deployments can both be cancelled.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Deployment ID (UUID returned on deploy).
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       "200":
 *         description: Deployment cancelled
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
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     status:
 *                       type: string
 *                       example: cancelled
 *                     cancelledAt:
 *                       type: string
 *                       format: date-time
 *       "404":
 *         description: txFunction not found
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
router.delete("/:id", strictLimiter, controller.cancel);

module.exports = router;

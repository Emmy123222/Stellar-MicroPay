/**
 * src/controllers/turretsController.js
 * HTTP handlers for Turrets txFunctions deployment and monitoring.
 */

"use strict";

const turretsService = require("../services/turretsService");

/**
 * @typedef {object} TxFunctionDeployment
 * @property {string} id
 * @property {string} ownerPublicKey
 * @property {"dca"|"stop_loss"|"escrow_release"} type
 * @property {"active"|"paused"|"completed"} status
 * @property {object} config - Normalized txFunction config for the given type
 * @property {string} deploymentHash
 * @property {string} signedChallengeXDR
 * @property {string} createdAt
 * @property {number} createdAtMs
 * @property {string} nextRunAt
 * @property {string|null} lastExecutedAt
 * @property {string|null} lastCheckedAt
 * @property {number|null} lastObservedPriceUsd
 * @property {string|null} lastError
 */

/**
 * @typedef {object} ExecutionHistoryEntry
 * @property {string} id
 * @property {string} deploymentId
 * @property {"created"|"executed"|"error"|"status"} status
 * @property {string} message
 * @property {object|null} result
 * @property {string} createdAt
 */

/**
 * @typedef {object} AuditLogEntry
 * @property {string} id
 * @property {string} action
 * @property {string} actor
 * @property {string} deploymentId
 * @property {object} details
 * @property {string} timestamp
 */

/**
 * POST /api/turrets/challenge
 * Build an unsigned challenge transaction the owner must sign to authorize deployment.
 *
 * @param {object} req - Express request
 * @param {object} req.body
 * @param {string} req.body.ownerPublicKey - Owner's Stellar public key (G...)
 * @param {"dca"|"stop_loss"|"escrow_release"} req.body.type - txFunction type
 * @param {object} req.body.config - Type-specific configuration (validated/normalized server-side)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: { challengeXDR: string, deploymentHash: string,
 *   normalizedConfig: object, networkPassphrase: string } }`
 */
async function createChallenge(req, res, next) {
  try {
    const { ownerPublicKey, type, config } = req.body;
    const data = await turretsService.createSigningChallenge({ ownerPublicKey, type, config });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/turrets/deploy
 * Deploy a signed txFunction after verifying the owner's signature.
 *
 * @param {object} req - Express request
 * @param {object} req.body
 * @param {string} req.body.ownerPublicKey - Owner's Stellar public key (G...)
 * @param {"dca"|"stop_loss"|"escrow_release"} req.body.type - txFunction type
 * @param {object} req.body.config - Type-specific configuration
 * @param {string} req.body.deploymentHash - Hash returned by the challenge step
 * @param {string} req.body.signedChallengeXDR - Challenge transaction signed by the owner
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {void} 201 JSON: `{ success: true, data: TxFunctionDeployment }`
 */
function deploy(req, res, next) {
  try {
    const { ownerPublicKey, type, config, deploymentHash, signedChallengeXDR } = req.body;
    const data = turretsService.deployTxFunction({
      ownerPublicKey,
      type,
      config,
      deploymentHash,
      signedChallengeXDR,
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/turrets?ownerPublicKey=<publicKey>
 * List deployed txFunctions, optionally filtered by owner.
 *
 * @param {object} req - Express request
 * @param {object} req.query
 * @param {string} [req.query.ownerPublicKey] - Filter to deployments owned by this public key
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {void} JSON: `{ success: true, data: TxFunctionDeployment[] }`
 */
function list(req, res, next) {
  try {
    const ownerPublicKey = req.query.ownerPublicKey;
    const data = turretsService.listDeployments(ownerPublicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/turrets/:id
 * Get a single txFunction deployment by ID.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.id - Deployment ID
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {void} JSON: `{ success: true, data: TxFunctionDeployment }`, or 404 (via next)
 *   when the deployment doesn't exist
 */
function getOne(req, res, next) {
  try {
    const { id } = req.params;
    const data = turretsService.getDeployment(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/turrets/:id/history
 * Get execution history for a txFunction deployment.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.id - Deployment ID
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {void} JSON: `{ success: true, data: ExecutionHistoryEntry[] }`, or 404 (via next)
 *   when the deployment doesn't exist
 */
function getHistory(req, res, next) {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    turretsService.getDeployment(id);
    const history = turretsService.getExecutionHistory(id);

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedData = history.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedData,
      pagination: {
        total: history.length,
        page,
        limit,
        pages: Math.ceil(history.length / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/turrets/:id/pause
 * Pause an active txFunction deployment.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.id - Deployment ID
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {void} JSON: `{ success: true, data: TxFunctionDeployment }`
 */
function pause(req, res, next) {
  try {
    const { id } = req.params;
    const actor = req.user?.publicKey; // From JWT auth middleware
    const data = turretsService.setDeploymentStatus(id, "paused", actor);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/turrets/:id/resume
 * Resume a paused txFunction deployment.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.id - Deployment ID
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {void} JSON: `{ success: true, data: TxFunctionDeployment }`
 */
function resume(req, res, next) {
  try {
    const { id } = req.params;
    const actor = req.user?.publicKey; // From JWT auth middleware
    const data = turretsService.setDeploymentStatus(id, "active", actor);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/turrets/audit-log
 * Get audit log entries, optionally filtered.
 *
 * @param {object} req - Express request
 * @param {object} req.query
 * @param {string} [req.query.actor] - Filter by actor's Stellar public key
 * @param {string} [req.query.deploymentId] - Filter by deployment ID
 * @param {string} [req.query.action] - Filter by action name (e.g. "deploy", "paused")
 * @param {string} [req.query.limit] - Max entries to return
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {void} JSON: `{ success: true, data: AuditLogEntry[] }`
 */
function getAuditLog(req, res, next) {
  try {
    const { actor, deploymentId, action, limit } = req.query;
    const filters = {};
    if (actor) filters.actor = actor;
    if (deploymentId) filters.deploymentId = deploymentId;
    if (action) filters.action = action;
    if (limit) filters.limit = parseInt(limit, 10);
    const data = turretsService.getAuditLog(filters);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createChallenge,
  deploy,
  list,
  getOne,
  getHistory,
  pause,
  resume,
  getAuditLog,
};

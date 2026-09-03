/**
 * src/controllers/turretsController.js
 * HTTP handlers for Turrets txFunctions deployment and monitoring.
 */

"use strict";

const turretsService = require("../services/turretsService");

async function createChallenge(req, res, next) {
  try {
    const { ownerPublicKey, type, config } = req.body;
    const data = await turretsService.createSigningChallenge({ ownerPublicKey, type, config });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

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

function list(req, res, next) {
  try {
    const ownerPublicKey = req.query.ownerPublicKey;
    const data = turretsService.listDeployments(ownerPublicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

function getOne(req, res, next) {
  try {
    const { id } = req.params;
    const data = turretsService.getDeployment(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

function getHistory(req, res, next) {
  try {
    const { id } = req.params;
    turretsService.getDeployment(id);
    const data = turretsService.getExecutionHistory(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

function pause(req, res, next) {
  try {
    const { id } = req.params;
    const data = turretsService.setDeploymentStatus(id, "paused");
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

function resume(req, res, next) {
  try {
    const { id } = req.params;
    const data = turretsService.setDeploymentStatus(id, "active");
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
};

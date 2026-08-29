"use strict";

const crypto = require("crypto");
const { Account, Asset, Keypair, Networks, Operation, Transaction, TransactionBuilder } = require("@stellar/stellar-sdk");
const { server } = require("../config/stellar");
const logger = require("../utils/logger");

const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

const deployments = new Map();
const executionHistory = [];
const auditLog = [];

let runnerStarted = false;
let runnerTimer = null;

function stopRunner() {
  if (runnerTimer) {
    clearInterval(runnerTimer);
    runnerTimer = null;
  }
  runnerStarted = false;
  logger.info("[turrets] Runner stopped");
}

function addAuditLog(action, actor, deploymentId, details = {}) {
  const entry = { id: crypto.randomUUID(), action, actor, deploymentId, details, timestamp: new Date().toISOString() };
  auditLog.push(entry);
  if (auditLog.length > 5000) auditLog.splice(0, auditLog.length - 5000);
  logger.info({ audit: true, action, actor, deploymentId, details }, `Turrets audit: ${action} by ${actor}`);
}

function validatePublicKey(publicKey) {
  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const err = new Error("Invalid Stellar public key format");
    err.status = 400;
    throw err;
  }
}

function getConfigHash(type, config) {
  return crypto.createHash("sha256").update(JSON.stringify({ type, config })).digest("hex");
}

function normalizeDcaConfig(config = {}) {
  const intervalMinutes = Number(config.intervalMinutes || 60);
  const amountQuote = Number(config.amountQuote || 10);
  const quoteAssetCode = (config.quoteAssetCode || "USDC").toUpperCase();
  const quoteAssetIssuer = config.quoteAssetIssuer || null;

  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
    const err = new Error("DCA intervalMinutes must be at least 1");
    err.status = 400;
    throw err;
  }

  if (!Number.isFinite(amountQuote) || amountQuote <= 0) {
    const err = new Error("DCA amountQuote must be greater than 0");
    err.status = 400;
    throw err;
  }

  return { intervalMinutes, amountQuote, quoteAssetCode, quoteAssetIssuer };
}

function normalizeStopLossConfig(config = {}) {
  const thresholdPrice = Number(config.thresholdPrice);
  const amountSell = Number(config.amountSell || 0);
  const sellAssetCode = (config.sellAssetCode || "XLM").toUpperCase();
  const sellAssetIssuer = config.sellAssetIssuer || null;
  const cooldownMinutes = Number(config.cooldownMinutes || 30);

  if (!Number.isFinite(thresholdPrice) || thresholdPrice <= 0) {
    const err = new Error("Stop-loss thresholdPrice must be greater than 0");
    err.status = 400;
    throw err;
  }

  if (!Number.isFinite(amountSell) || amountSell <= 0) {
    const err = new Error("Stop-loss amountSell must be greater than 0");
    err.status = 400;
    throw err;
  }

  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 1) {
    const err = new Error("Stop-loss cooldownMinutes must be at least 1");
    err.status = 400;
    throw err;
  }

  return { thresholdPrice, amountSell, sellAssetCode, sellAssetIssuer, cooldownMinutes };
}

function normalizeEscrowReleaseConfig(config = {}) {
  const escrowPublicKey = config.escrowPublicKey || null;
  const beneficiaryPublicKey = config.beneficiaryPublicKey || null;
  const releaseAmount = Number(config.releaseAmount || 0);
  const assetCode = (config.assetCode || "XLM").toUpperCase();
  const assetIssuer = config.assetIssuer || null;
  const releaseCondition = config.releaseCondition || "time";
  const releaseAfterMs = Number(config.releaseAfterMs || 0);

  if (!escrowPublicKey || !/^G[A-Z0-9]{55}$/.test(escrowPublicKey)) {
    const err = new Error("escrow_release: valid escrowPublicKey is required");
    err.status = 400;
    throw err;
  }

  if (!beneficiaryPublicKey || !/^G[A-Z0-9]{55}$/.test(beneficiaryPublicKey)) {
    const err = new Error("escrow_release: valid beneficiaryPublicKey is required");
    err.status = 400;
    throw err;
  }

  return { escrowPublicKey, beneficiaryPublicKey, releaseAmount, assetCode, assetIssuer, releaseCondition, releaseAfterMs };
}

async function createSigningChallenge({ ownerPublicKey, type, config }) {
  validatePublicKey(ownerPublicKey);
  let normalizedConfig;

  switch (type) {
    case "dca": normalizedConfig = normalizeDcaConfig(config); break;
    case "stop_loss": normalizedConfig = normalizeStopLossConfig(config); break;
    case "escrow_release": normalizedConfig = normalizeEscrowReleaseConfig(config); break;
    default:
      const err = new Error("Unknown txFunction type");
      err.status = 400;
      throw err;
  }

  const deploymentHash = getConfigHash(type, normalizedConfig);
  const sourceKeypair = Keypair.random();
  const account = new Account(sourceKeypair.publicKey(), "0");
  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.payment({ destination: ownerPublicKey, asset: Asset.native(), amount: "0.0000001" }))
    .setSequence("1")
    .setTimeout(300)
    .build();

  return {
    challengeXDR: tx.toXDR(),
    deploymentHash,
    normalizedConfig,
    networkPassphrase: NETWORK_PASSPHRASE,
  };
}

function deployTxFunction({ ownerPublicKey, type, config, deploymentHash, signedChallengeXDR }) {
  const id = crypto.randomUUID();
  const deployment = {
    id,
    ownerPublicKey,
    type,
    config,
    deploymentHash,
    signedChallengeXDR,
    status: "active",
    createdAt: new Date().toISOString(),
    nextRunAt: new Date(Date.now() + 60000).toISOString(),
    lastExecutedAt: null,
    lastError: null,
  };

  deployments.set(id, deployment);
  addAuditLog("deploy", ownerPublicKey, id, { type });
  return deployment;
}

function listDeployments(ownerPublicKey) {
  return Array.from(deployments.values()).filter((d) => d.ownerPublicKey === ownerPublicKey);
}

function getDeployment(id) {
  const d = deployments.get(id);
  if (!d) {
    const err = new Error("txFunction not found");
    err.status = 404;
    throw err;
  }
  return d;
}

function updateDeploymentStatus(id, status, error = null) {
  const d = deployments.get(id);
  if (d) {
    d.status = status;
    if (error) d.lastError = error;
    deployments.set(id, d);
  }
}

function startRunner(intervalMs = 60000) {
  if (runnerStarted) return;
  runnerStarted = true;
  runnerTimer = setInterval(async () => {
    for (const [id, d] of deployments.entries()) {
      if (d.status !== "active") continue;
      if (new Date(d.nextRunAt) > new Date()) continue;
      logger.info({ id }, "[turrets] Executing scheduled txFunction");
      d.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      deployments.set(id, d);
    }
  }, intervalMs);
}

module.exports = {
  createSigningChallenge,
  deployTxFunction,
  listDeployments,
  getDeployment,
  updateDeploymentStatus,
  startRunner,
  stopRunner,
};

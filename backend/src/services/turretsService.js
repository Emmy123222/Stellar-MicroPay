/**
 * src/services/turretsService.js
 * In-memory Turrets txFunctions registry with DCA and stop-loss evaluators.
 */

"use strict";

const crypto = require("crypto");
const {
  Account,
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} = require("@stellar/stellar-sdk");

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

const server = new Horizon.Server(HORIZON_URL);

const deployments = new Map();
const executionHistory = [];

let runnerStarted = false;
let runnerTimer = null;

function validatePublicKey(publicKey) {
  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const err = new Error("Invalid Stellar public key format");
    err.status = 400;
    throw err;
  }
}

function getConfigHash(type, config) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ type, config }))
    .digest("hex");
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

  return {
    intervalMinutes,
    amountQuote,
    quoteAssetCode,
    quoteAssetIssuer,
  };
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

  return {
    thresholdPrice,
    amountSell,
    sellAssetCode,
    sellAssetIssuer,
    cooldownMinutes,
  };
}

function normalizeConfig(type, config) {
  if (type === "dca") return normalizeDcaConfig(config);
  if (type === "stop_loss") return normalizeStopLossConfig(config);
  const err = new Error("Unsupported txFunction type. Use 'dca' or 'stop_loss'.");
  err.status = 400;
  throw err;
}

async function createSigningChallenge({ ownerPublicKey, type, config }) {
  validatePublicKey(ownerPublicKey);

  const normalizedConfig = normalizeConfig(type, config);
  const deploymentHash = getConfigHash(type, normalizedConfig);

  let sourceAccount;
  try {
    sourceAccount = await server.loadAccount(ownerPublicKey);
  } catch {
    sourceAccount = new Account(ownerPublicKey, "0");
  }

  const challengeTx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.manageData({
        name: `turrets-deploy:${type}`,
        value: deploymentHash,
      })
    )
    .setTimeout(300)
    .build();

  return {
    challengeXDR: challengeTx.toXDR(),
    deploymentHash,
    normalizedConfig,
    networkPassphrase: NETWORK_PASSPHRASE,
  };
}

function verifySignedChallenge({ ownerPublicKey, signedChallengeXDR }) {
  validatePublicKey(ownerPublicKey);

  const tx = new Transaction(signedChallengeXDR, NETWORK_PASSPHRASE);

  if (tx.source !== ownerPublicKey) {
    const err = new Error("Signed challenge source account mismatch");
    err.status = 400;
    throw err;
  }

  const signer = Keypair.fromPublicKey(ownerPublicKey);
  const expectedHint = Buffer.from(signer.signatureHint()).toString("hex");
  const txHash = tx.hash();

  const hasValidSignature = tx.signatures.some((sig) => {
    const hint = Buffer.from(sig.hint()).toString("hex");
    if (hint !== expectedHint) return false;
    try {
      return signer.verify(txHash, sig.signature());
    } catch {
      return false;
    }
  });

  if (!hasValidSignature) {
    const err = new Error("Signed challenge was not signed by the owner account");
    err.status = 401;
    throw err;
  }
}

function toDexAsset(code, issuer) {
  if (code === "XLM") return Asset.native();
  if (!issuer) {
    const err = new Error(`Asset issuer is required for non-native asset ${code}`);
    err.status = 400;
    throw err;
  }
  return new Asset(code, issuer);
}

function dcaTxFunction(config, xlmUsdPrice) {
  const quoteToXlm = xlmUsdPrice > 0 ? 1 / xlmUsdPrice : 0;
  const estXlm = config.amountQuote * quoteToXlm;

  return {
    action: "buy_xlm_dca",
    dexOperation: "manageSellOffer",
    selling: {
      code: config.quoteAssetCode,
      issuer: config.quoteAssetIssuer,
    },
    buying: { code: "XLM", issuer: null },
    quoteAmount: config.amountQuote.toFixed(7),
    estimatedXlm: estXlm.toFixed(7),
    referencePriceUsd: xlmUsdPrice,
    note: "Place a DEX sell offer to swap quote asset into XLM on schedule.",
  };
}

function stopLossTxFunction(config, xlmUsdPrice) {
  return {
    action: "stop_loss_sell",
    dexOperation: "manageSellOffer",
    selling: {
      code: config.sellAssetCode,
      issuer: config.sellAssetIssuer,
    },
    buying: { code: "XLM", issuer: null },
    amount: config.amountSell.toFixed(7),
    triggerPriceUsd: config.thresholdPrice,
    observedPriceUsd: xlmUsdPrice,
    note: "Sell configured asset into XLM when observed price is below threshold.",
  };
}

function addExecutionLog(deploymentId, status, message, result = null) {
  executionHistory.push({
    id: crypto.randomUUID(),
    deploymentId,
    status,
    message,
    result,
    createdAt: new Date().toISOString(),
  });

  if (executionHistory.length > 1000) {
    executionHistory.splice(0, executionHistory.length - 1000);
  }
}

let priceCache = { value: null, fetchedAt: 0 };

async function getXlmUsdPrice() {
  const now = Date.now();
  if (priceCache.value !== null && now - priceCache.fetchedAt < 30_000) {
    return priceCache.value;
  }

  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd"
  );

  if (!res.ok) {
    throw new Error(`Price lookup failed (${res.status})`);
  }

  const data = await res.json();
  const value = Number(data?.stellar?.usd);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid price response from upstream provider");
  }

  priceCache = { value, fetchedAt: now };
  return value;
}

function nextRunIso(intervalMinutes) {
  return new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
}

async function evaluateDeployment(deployment) {
  const now = Date.now();
  const nextRunMs = deployment.nextRunAt ? Date.parse(deployment.nextRunAt) : 0;

  if (nextRunMs && now < nextRunMs) return;

  try {
    const price = await getXlmUsdPrice();
    deployment.lastObservedPriceUsd = price;
    deployment.lastCheckedAt = new Date().toISOString();

    if (deployment.type === "dca") {
      const result = dcaTxFunction(deployment.config, price);
      deployment.lastExecutedAt = new Date().toISOString();
      deployment.nextRunAt = nextRunIso(deployment.config.intervalMinutes);
      addExecutionLog(deployment.id, "executed", "DCA txFunction generated", result);
      return;
    }

    if (deployment.type === "stop_loss") {
      if (price <= deployment.config.thresholdPrice) {
        const result = stopLossTxFunction(deployment.config, price);
        deployment.lastExecutedAt = new Date().toISOString();
        deployment.nextRunAt = nextRunIso(deployment.config.cooldownMinutes);
        addExecutionLog(deployment.id, "executed", "Stop-loss condition met", result);
      } else {
        deployment.nextRunAt = new Date(Date.now() + 60 * 1000).toISOString();
      }
    }
  } catch (err) {
    deployment.lastError = err.message;
    deployment.lastCheckedAt = new Date().toISOString();
    addExecutionLog(deployment.id, "error", err.message);
  }
}

function startRunner() {
  if (runnerStarted) return;
  runnerStarted = true;

  const pollIntervalMs = Number(process.env.TURRETS_EVALUATION_INTERVAL_MS || 30_000);

  runnerTimer = setInterval(async () => {
    for (const deployment of deployments.values()) {
      if (deployment.status !== "active") continue;
      await evaluateDeployment(deployment);
    }
  }, pollIntervalMs);
}

function stopRunner() {
  if (runnerTimer) clearInterval(runnerTimer);
  runnerTimer = null;
  runnerStarted = false;
}

function deployTxFunction({ ownerPublicKey, type, config, deploymentHash, signedChallengeXDR }) {
  validatePublicKey(ownerPublicKey);
  verifySignedChallenge({ ownerPublicKey, signedChallengeXDR });

  const normalizedConfig = normalizeConfig(type, config);
  const calculatedHash = getConfigHash(type, normalizedConfig);

  if (calculatedHash !== deploymentHash) {
    const err = new Error("Configuration hash mismatch. Recreate challenge and sign again.");
    err.status = 400;
    throw err;
  }

  if (type === "dca") {
    toDexAsset(normalizedConfig.quoteAssetCode, normalizedConfig.quoteAssetIssuer);
  }

  if (type === "stop_loss") {
    toDexAsset(normalizedConfig.sellAssetCode, normalizedConfig.sellAssetIssuer);
  }

  const id = crypto.randomUUID();

  const deployment = {
    id,
    ownerPublicKey,
    type,
    status: "active",
    config: normalizedConfig,
    deploymentHash,
    signedChallengeXDR,
    createdAt: new Date().toISOString(),
    nextRunAt:
      type === "dca"
        ? nextRunIso(normalizedConfig.intervalMinutes)
        : new Date(Date.now() + 60 * 1000).toISOString(),
    lastExecutedAt: null,
    lastCheckedAt: null,
    lastObservedPriceUsd: null,
    lastError: null,
  };

  deployments.set(id, deployment);
  addExecutionLog(id, "created", "txFunction deployed");

  startRunner();

  return deployment;
}

function listDeployments(ownerPublicKey) {
  if (ownerPublicKey) {
    validatePublicKey(ownerPublicKey);
    return Array.from(deployments.values()).filter((d) => d.ownerPublicKey === ownerPublicKey);
  }
  return Array.from(deployments.values());
}

function getDeployment(id) {
  const deployment = deployments.get(id);
  if (!deployment) {
    const err = new Error("txFunction not found");
    err.status = 404;
    throw err;
  }
  return deployment;
}

function getExecutionHistory(deploymentId) {
  return executionHistory
    .filter((entry) => entry.deploymentId === deploymentId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function setDeploymentStatus(id, status) {
  const deployment = getDeployment(id);
  deployment.status = status;
  addExecutionLog(id, "status", `txFunction ${status}`);
  return deployment;
}

module.exports = {
  createSigningChallenge,
  deployTxFunction,
  listDeployments,
  getDeployment,
  getExecutionHistory,
  setDeploymentStatus,
  startRunner,
  stopRunner,
};

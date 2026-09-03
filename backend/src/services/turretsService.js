"use strict";

const crypto = require("crypto");

const {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} = require("@stellar/stellar-sdk");

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

  // Also log to structured logger for persistence
  logger.info(
    {
      audit: true,
      action,
      actor,
      deploymentId,
      details,
    },
    `Turrets audit: ${action} by ${actor}`
  );
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

  if (!Number.isFinite(releaseAmount) || releaseAmount <= 0) {
    const err = new Error("escrow_release: releaseAmount must be greater than 0");
    err.status = 400;
    throw err;
  }

  if (!["time", "manual"].includes(releaseCondition)) {
    const err = new Error("escrow_release: releaseCondition must be 'time' or 'manual'");
    err.status = 400;
    throw err;
  }

  if (releaseCondition === "time" && (!Number.isFinite(releaseAfterMs) || releaseAfterMs <= 0)) {
    const err = new Error(
      "escrow_release: releaseAfterMs must be greater than 0 for time-based release"
    );
    err.status = 400;
    throw err;
  }

  return {
    escrowPublicKey,
    beneficiaryPublicKey,
    releaseAmount,
    assetCode,
    assetIssuer,
    releaseCondition,
    releaseAfterMs,
  };
}

function normalizeConfig(type, config) {
  if (type === "dca") return normalizeDcaConfig(config);
  if (type === "stop_loss") return normalizeStopLossConfig(config);
  if (type === "escrow_release") return normalizeEscrowReleaseConfig(config);
  const err = new Error(
    "Unsupported txFunction type. Use 'dca', 'stop_loss', or 'escrow_release'."
  );
  err.status = 400;
  throw err;
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

function escrowReleaseTxFunction(config) {
  const asset =
    config.assetCode === "XLM"
      ? { code: "XLM", issuer: null }
      : { code: config.assetCode, issuer: config.assetIssuer };

  return {
    action: "escrow_release",
    stellarOperation: "payment",
    from: config.escrowPublicKey,
    to: config.beneficiaryPublicKey,
    asset,
    amount: config.releaseAmount.toFixed(7),
    releaseCondition: config.releaseCondition,
    note: "Release escrowed funds to beneficiary without the backend holding private keys.",
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

const PRICE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const PRICE_MIN_VALID = 0.0001;
const PRICE_MAX_VALID = 10.0;

async function fetchCoinGeckoPrice() {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd&include_last_updated_at=true"
  );
  if (!res.ok) throw new Error(`CoinGecko failed (${res.status})`);
  const data = await res.json();
  const value = Number(data?.stellar?.usd);
  const updatedAt = Number(data?.stellar?.last_updated_at) * 1000;
  return { value, updatedAt, source: "coingecko" };
}

async function fetchBinancePrice() {
  const res = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=XLMUSDT");
  if (!res.ok) throw new Error(`Binance failed (${res.status})`);
  const data = await res.json();
  const value = Number(data?.lastPrice);
  const updatedAt = Number(data?.closeTime);
  return { value, updatedAt, source: "binance" };
}

function validatePriceData(data, now) {
  if (!data || !Number.isFinite(data.value) || !Number.isFinite(data.updatedAt)) {
    throw new Error("Malformed price data: missing or invalid value/timestamp");
  }
  if (data.value < PRICE_MIN_VALID || data.value > PRICE_MAX_VALID) {
    throw new Error(
      `Price out of sanity range (${PRICE_MIN_VALID} - ${PRICE_MAX_VALID}): ${data.value}`
    );
  }

  const age = now - data.updatedAt;
  if (age < -60_000) {
    throw new Error(`Price timestamp is in the future: ${data.updatedAt}`);
  } else if (age > PRICE_MAX_AGE_MS) {
    throw new Error(`Price data is stale. Age: ${age}ms, Max: ${PRICE_MAX_AGE_MS}ms`);
  }
  return true;
}

let priceCache = { value: null, fetchedAt: 0, updatedAt: 0 };

function resetPriceCache() {
  priceCache = { value: null, fetchedAt: 0, updatedAt: 0 };
}

async function getXlmUsdPrice() {
  const now = Date.now();

  if (
    priceCache.value !== null &&
    now - priceCache.fetchedAt < 30_000 &&
    now - priceCache.updatedAt < PRICE_MAX_AGE_MS
  ) {
    return priceCache.value;
  }

  let priceData = null;
  let errors = [];

  // Primary: CoinGecko
  try {
    const cgData = await fetchCoinGeckoPrice();
    validatePriceData(cgData, now);
    priceData = cgData;
  } catch (err) {
    errors.push(err.message);
    logger.warn({ err: err.message }, "CoinGecko price fetch failed, attempting fallback");
  }

  // Fallback: Binance (Documented fallback strategy)
  if (!priceData) {
    try {
      const binData = await fetchBinancePrice();
      validatePriceData(binData, now);
      priceData = binData;
    } catch (err) {
      errors.push(err.message);
      logger.warn({ err: err.message }, "Binance price fetch failed");
    }
  }

  if (!priceData) {
    throw new Error(`All price oracles failed or returned invalid data: ${errors.join(" | ")}`);
  }

  priceCache = { value: priceData.value, fetchedAt: now, updatedAt: priceData.updatedAt };
  return priceData.value;
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

    if (deployment.type === "escrow_release") {
      const releaseAt = deployment.createdAtMs + deployment.config.releaseAfterMs;
      if (deployment.config.releaseCondition === "time" && now >= releaseAt) {
        const result = escrowReleaseTxFunction(deployment.config);
        deployment.lastExecutedAt = new Date().toISOString();
        deployment.status = "completed";
        addExecutionLog(
          deployment.id,
          "executed",
          "Escrow time-lock expired, release triggered",
          result
        );
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
  _getXlmUsdPrice: getXlmUsdPrice,
  _resetPriceCache: resetPriceCache,
};

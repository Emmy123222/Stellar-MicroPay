/**
 * src/services/eventStreamService.js
 * Soroban contract event streaming for Stellar MicroPay.
 *
 * Soroban RPC has no push API, so "streaming" here means polling
 * `SorobanRpc.Server.getEvents` for the MicroPay contract and normalising every
 * contract event into one flat shape the dashboard can render:
 *
 *   {
 *     id, type, participants, amount, asset, ledger, closedAt,
 *     contractId, transactionHash, rawValue
 *   }
 *
 * `type` is derived from the event's first topic symbol, so the contract's
 * `tip` / `receipt` events and any future `open` / `claim` / `top_up` / `close`
 * events all flow through without a schema change on this side.
 */

"use strict";

const { SorobanRpc, scValToNative } = require("@stellar/stellar-sdk");
require("dotenv").config();

const DEFAULT_TESTNET_RPC = "https://soroban-testnet.stellar.org";
const DEFAULT_MAINNET_RPC = "https://soroban.stellar.org";

/** Stroops per XLM — Soroban i128 amounts are stroops. */
const STROOPS_PER_XLM = 10_000_000;

/** Contract event names the dashboard knows how to label. */
const KNOWN_EVENT_TYPES = [
  "open",
  "claim",
  "top_up",
  "close",
  "tip",
  "receipt",
  "refund",
];

/** Alternate spellings seen in the wild, mapped onto canonical names. */
const EVENT_TYPE_ALIASES = {
  topup: "top_up",
  topups: "top_up",
  top_up: "top_up",
  top_up_: "top_up",
  payment: "tip",
  sendtip: "tip",
  send_tip: "tip",
};

// ─── Config ──────────────────────────────────────────────────────────────────

/** Active Stellar network, e.g. `testnet` or `mainnet`. */
function getNetwork() {
  return process.env.STELLAR_NETWORK || "testnet";
}

/** Soroban RPC endpoint for the active network. */
function getRpcUrl() {
  if (process.env.SOROBAN_RPC_URL) return process.env.SOROBAN_RPC_URL;
  return getNetwork() === "mainnet" ? DEFAULT_MAINNET_RPC : DEFAULT_TESTNET_RPC;
}

/** Deployed MicroPay contract ID, or `""` when not configured. */
function getContractId() {
  return (
    process.env.CONTRACT_ID ||
    process.env.SOROBAN_CONTRACT_ID ||
    process.env.NEXT_PUBLIC_CONTRACT_ID ||
    ""
  );
}

/**
 * Resolved stream configuration. `contractId` being empty is not an error —
 * the endpoint still opens and reports the missing configuration to the client.
 */
function getEventStreamConfig() {
  return {
    contractId: getContractId(),
    network: getNetwork(),
    rpcUrl: getRpcUrl(),
    pollIntervalMs: Number(process.env.EVENTS_POLL_INTERVAL_MS || 5000),
    ledgerLookback: Number(process.env.EVENTS_LEDGER_LOOKBACK || 20),
    configured: Boolean(getContractId()),
  };
}

// ─── Soroban RPC ─────────────────────────────────────────────────────────────

let cachedServer = null;

/** Lazily-created Soroban RPC client, re-created if the URL changes. */
function getSorobanServer() {
  const url = getRpcUrl();
  if (!cachedServer || String(cachedServer.serverURL) !== url) {
    cachedServer = new SorobanRpc.Server(url);
  }
  return cachedServer;
}

/**
 * Fetch one page of contract events.
 *
 * @param {object} options
 * @param {string} [options.contractId] Contract to filter on.
 * @param {number} [options.startLedger] Ledger to start from (used on first poll).
 * @param {string} [options.cursor] Resume cursor returned by a previous page.
 * @param {number} [options.limit] Page size, capped at 200 by RPC.
 * @param {object} [options.server] Injected RPC client (tests).
 * @returns {Promise<{events: object[], latestLedger: number|null, cursor: string|null}>}
 */
async function fetchContractEvents({
  contractId = getContractId(),
  startLedger,
  cursor,
  limit = 100,
  server,
} = {}) {
  if (!contractId) {
    return { events: [], latestLedger: null, cursor: null };
  }

  const rpc = server || getSorobanServer();

  const request = {
    filters: [{ type: "contract", contractIds: [contractId] }],
    limit,
  };

  if (cursor) {
    request.cursor = cursor;
  } else {
    request.startLedger = startLedger;
  }

  const page = await rpc.getEvents(request);

  return {
    events: page.events || [],
    latestLedger: page.latestLedger ?? null,
    cursor: page.cursor ?? null,
  };
}

/** Latest closed ledger sequence, or `null` when RPC is unreachable. */
async function fetchLatestLedger(server) {
  try {
    const rpc = server || getSorobanServer();
    const response = await rpc.getLatestLedger();
    return response?.sequence ?? null;
  } catch (err) {
    console.error("Failed to read latest Soroban ledger:", err.message);
    return null;
  }
}

// ─── Normalisation ───────────────────────────────────────────────────────────

/**
 * Convert an event topic entry (usually an `xdr.ScVal`) into a plain JS value.
 * Returns `null` when the value cannot be interpreted.
 */
function scValToPlain(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return scValToNative(value);
  } catch {
    return null;
  }
}

/**
 * Map a raw event symbol onto a canonical event type.
 *
 * Unknown symbols are returned lower-cased with spaces/dashes collapsed to
 * underscores so the UI can still show something meaningful.
 */
function mapEventType(symbol) {
  if (symbol === null || symbol === undefined) return "unknown";

  const normalized = String(symbol).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return "unknown";

  return EVENT_TYPE_ALIASES[normalized] || normalized;
}

function isStellarAddress(value) {
  return typeof value === "string" && /^G[A-Z0-9]{55}$/.test(value);
}

/** Render a stroop amount as an XLM string, or `null` when not numeric. */
function stroopsToXlmString(value) {
  if (value === null || value === undefined) return null;

  let numeric;
  if (typeof value === "bigint") {
    numeric = Number(value) / STROOPS_PER_XLM;
  } else if (typeof value === "number") {
    numeric = value / STROOPS_PER_XLM;
  } else {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    numeric = parsed / STROOPS_PER_XLM;
  }

  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(7);
}

/**
 * Normalise a raw Soroban RPC event into the flat shape the dashboard renders.
 *
 * @param {object} event Raw `SorobanRpc.Api.EventResponse` entry.
 * @returns {object} Normalised contract event.
 */
function normalizeContractEvent(event) {
  const topics = Array.isArray(event?.topic) ? event.topic : [];
  const plainTopics = topics.map(scValToPlain);

  const type = mapEventType(plainTopics[0]);

  // Every topic beyond the leading symbol that looks like an account is a
  // participant; anything else is kept in `topicLabels` for context.
  const participants = [];
  const topicLabels = [];

  for (const topic of plainTopics.slice(1)) {
    if (isStellarAddress(topic)) {
      participants.push(topic);
    } else if (topic !== null && topic !== undefined) {
      topicLabels.push(String(topic));
    }
  }

  const value = scValToPlain(event?.value);
  const amount = stroopsToXlmString(value);

  return {
    id: String(event?.id ?? event?.pagingToken ?? `${event?.ledger}-${event?.txHash ?? ""}`),
    type,
    participants,
    topicLabels,
    amount,
    asset: amount === null ? null : "XLM",
    ledger: Number(event?.ledger ?? 0),
    closedAt: event?.ledgerClosedAt ?? null,
    contractId: event?.contractId ?? null,
    transactionHash: event?.txHash ?? null,
    rawValue: value === null || value === undefined ? null : String(value),
  };
}

module.exports = {
  KNOWN_EVENT_TYPES,
  getNetwork,
  getRpcUrl,
  getContractId,
  getEventStreamConfig,
  getSorobanServer,
  fetchContractEvents,
  fetchLatestLedger,
  normalizeContractEvent,
  mapEventType,
  isStellarAddress,
  stroopsToXlmString,
  STROOPS_PER_XLM,
};

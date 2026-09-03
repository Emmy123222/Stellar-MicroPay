/**
 * src/services/webhookQueue.js
 * Bounded in-memory queue that owns webhook delivery so the Horizon stream
 * callback never performs network I/O (#770).
 *
 * Design:
 *  - `enqueueDelivery` is synchronous: the monitor enqueues and returns
 *    immediately; a worker pool delivers (and retries) off the stream path.
 *  - Retries use exponential backoff with full jitter and are bounded by
 *    WEBHOOK_MAX_ATTEMPTS; exhausted deliveries move to a dead-letter state.
 *  - The queue and the dead-letter list are both bounded (oldest is dropped
 *    for the dead-letter list; new deliveries are rejected when the queue is
 *    full) so a slow receiver can never consume unbounded resources.
 *  - The latest delivery status per webhook is exposed via `getDeliveryStatus`
 *    and surfaced through GET /api/webhooks/:publicKey.
 *
 * State is module-level and in-memory, mirroring webhookStore.js: a server
 * restart drops queued/dead-lettered deliveries (operators can re-trigger by
 * the payment monitor resuming streams for new events).
 */

"use strict";

const crypto = require("crypto");

const logger = require("../utils/logger");

const { deliverWebhook } = require("./webhookDelivery");
const { getWebhookById } = require("./webhookStore");

/**
 * Delivery lifecycle states.
 * @typedef {'pending'|'in_flight'|'retrying'|'delivered'|'dead_letter'|'dropped'} DeliveryState
 */
const STATES = {
  PENDING: "pending",
  IN_FLIGHT: "in_flight",
  RETRYING: "retrying",
  DELIVERED: "delivered",
  DEAD_LETTER: "dead_letter",
  DROPPED: "dropped",
};

/**
 * Read a non-negative integer from the environment.
 * Falls back (with a warning) when unset or malformed.
 *
 * @param {string} name
 * @param {number} fallback
 * @param {{ min?: number }} [opts]
 * @returns {number}
 */
function envInt(name, fallback, { min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    logger.warn(
      { env: name, value: raw, fallback },
      `[webhook-queue] ignoring invalid ${name}`
    );
    return fallback;
  }
  return parsed;
}

const config = {
  // Bounded queue — new deliveries are rejected (counted + logged) when full.
  maxSize: envInt("WEBHOOK_QUEUE_MAX_SIZE", 1000, { min: 1 }),
  // Bounded retries — total delivery attempts before the dead-letter state.
  maxAttempts: envInt("WEBHOOK_MAX_ATTEMPTS", 5, { min: 1 }),
  // Exponential backoff: baseDelayMs * 2^(attempt-1), capped, + jitter.
  baseDelayMs: envInt("WEBHOOK_RETRY_BASE_DELAY_MS", 1000, { min: 0 }),
  maxDelayMs: envInt("WEBHOOK_RETRY_MAX_DELAY_MS", 60_000, { min: 0 }),
  // Worker pool bound — a slow receiver can occupy at most this many slots.
  maxConcurrent: envInt("WEBHOOK_MAX_CONCURRENT", 5, { min: 1 }),
  // Bounded dead-letter storage — oldest entries are evicted beyond this.
  dlqMaxSize: envInt("WEBHOOK_DLQ_MAX_SIZE", 200, { min: 1 }),
};

/** Fraction of the backoff cap used as uniform jitter (0..1). */
const JITTER_FACTOR = 0.2;

/**
 * @typedef {Object} DeliveryPayload
 * @property {'payment_received'} event
 * @property {string} publicKey
 * @property {string} amount
 * @property {string} asset
 * @property {string} from
 * @property {string} transactionHash
 * @property {number} ledger
 * @property {string} timestamp
 */

/**
 * @typedef {Object} DeliveryEntry
 * @property {string} id               - `${webhookId}:${transactionHash}`
 * @property {string} webhookId
 * @property {string} url
 * @property {string} secret
 * @property {DeliveryPayload} payload
 * @property {DeliveryState} state
 * @property {number} attempts
 * @property {number} nextAttemptAt    - epoch ms
 * @property {number} enqueuedAt       - epoch ms
 * @property {number|null} lastAttemptAt
 * @property {number|null} deliveredAt
 * @property {number|null} lastHttpStatus
 * @property {string|null} lastError
 */

/** Queue of entries awaiting delivery or retry, keyed by delivery id. @type {Map<string, DeliveryEntry>} */
const pending = new Map();

/** Dead-letter storage (bounded), keyed by delivery id. @type {Map<string, DeliveryEntry>} */
const deadLetters = new Map();

/** Latest delivery status snapshot per webhook, for status exposure. @type {Map<string, object>} */
const lastDeliveryByWebhook = new Map();

/** Totals since process start (observability). */
const totals = {
  enqueued: 0,
  duplicates: 0,
  rejectedQueueFull: 0,
  orphaned: 0,
  delivered: 0,
  deadLettered: 0,
};

let activeWorkers = 0;
/** @type {NodeJS.Timeout | null} */
let drainTimer = null;

/**
 * Backoff delay before the retry following `attempt` (1-indexed):
 * exponential growth capped at maxDelayMs, plus uniform jitter.
 *
 * @param {number} attempt
 * @returns {number} milliseconds
 */
function computeBackoffMs(attempt) {
  const exponential = config.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, config.maxDelayMs);
  const jitterWindow = Math.floor(capped * JITTER_FACTOR);
  const jitter = jitterWindow > 0 ? crypto.randomInt(0, jitterWindow + 1) : 0;
  return capped + jitter;
}

/**
 * Strip runtime-only fields (secret) before exposing a queue entry.
 *
 * @param {DeliveryEntry} entry
 * @returns {object}
 */
function sanitizeEntry(entry) {
  const rest = { ...entry };
  delete rest.secret;
  return {
    ...rest,
    enqueuedAt: new Date(entry.enqueuedAt).toISOString(),
    lastAttemptAt: entry.lastAttemptAt
      ? new Date(entry.lastAttemptAt).toISOString()
      : null,
    nextAttemptAt: entry.nextAttemptAt
      ? new Date(entry.nextAttemptAt).toISOString()
      : null,
    deliveredAt: entry.deliveredAt
      ? new Date(entry.deliveredAt).toISOString()
      : null,
  };
}

/**
 * Record the latest delivery status for a webhook (status exposure).
 *
 * @param {DeliveryEntry} entry
 * @param {{ nextAttemptAt?: number|null, deliveredAt?: number|null }} [extra]
 */
function updateSnapshot(entry, extra = {}) {
  lastDeliveryByWebhook.set(entry.webhookId, {
    webhookId: entry.webhookId,
    transactionHash: entry.payload.transactionHash,
    state: entry.state,
    attempts: entry.attempts,
    lastHttpStatus: entry.lastHttpStatus ?? null,
    lastError: entry.lastError ?? null,
    lastAttemptAt: entry.lastAttemptAt
      ? new Date(entry.lastAttemptAt).toISOString()
      : null,
    nextAttemptAt: extra.nextAttemptAt
      ? new Date(extra.nextAttemptAt).toISOString()
      : null,
    deliveredAt: extra.deliveredAt
      ? new Date(extra.deliveredAt).toISOString()
      : null,
  });
}

/**
 * Earliest time (epoch ms) a non-in-flight entry becomes due, or null when the
 * queue is empty.
 *
 * @returns {number | null}
 */
function earliestDueAt(now) {
  let earliest = null;
  for (const entry of pending.values()) {
    if (entry.state === STATES.IN_FLIGHT) continue;
    if (entry.nextAttemptAt <= now) return now;
    if (earliest === null || entry.nextAttemptAt < earliest) {
      earliest = entry.nextAttemptAt;
    }
  }
  return earliest;
}

/**
 * Launch deliveries for all due entries, bounded by the worker pool size.
 * Called by the scheduler and synchronously testable.
 */
function drain() {
  const slots = config.maxConcurrent - activeWorkers;
  if (slots <= 0) return;

  const now = Date.now();
  let launched = 0;
  for (const entry of pending.values()) {
    if (launched >= slots) break;
    if (entry.state === STATES.IN_FLIGHT) continue;
    if (entry.nextAttemptAt > now) continue;

    entry.state = STATES.IN_FLIGHT;
    launched += 1;
    activeWorkers += 1;
    void processEntry(entry);
  }
}

/**
 * (Re)arm the scheduler timer for the next due entry. In-flight completions
 * and new enqueues call this again; timers are unref'd so the process can exit.
 */
function scheduleDrain() {
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }

  if (config.maxConcurrent - activeWorkers <= 0) return; // a worker will reschedule

  const now = Date.now();
  const earliest = earliestDueAt(now);
  if (earliest === null) return;

  drainTimer = setTimeout(() => {
    drainTimer = null;
    drain();
  }, Math.max(0, earliest - now));
  drainTimer.unref?.();
}

/**
 * Attempt one delivery and transition the entry based on the result.
 *
 * @param {DeliveryEntry} entry
 */
async function processEntry(entry) {
  try {
    // The webhook may have been deleted after enqueueing — never deliver
    // to a URL the owner has revoked.
    if (!getWebhookById(entry.webhookId)) {
      pending.delete(entry.id);
      entry.state = STATES.DROPPED;
      totals.orphaned += 1;
      logger.info(
        { webhookId: entry.webhookId, deliveryId: entry.id },
        "[webhook-queue] dropping delivery — webhook was deleted"
      );
      return;
    }

    entry.attempts += 1;
    entry.lastAttemptAt = Date.now();

    let result;
    try {
      result = await deliverWebhook(
        { id: entry.webhookId, url: entry.url, secret: entry.secret },
        entry.payload
      );
    } catch (err) {
      // deliverWebhook never throws; belt-and-braces so the worker survives.
      result = { ok: false, httpStatus: null, error: err?.message ?? String(err) };
    }

    entry.lastHttpStatus = result.httpStatus ?? null;
    entry.lastError = result.ok ? null : (result.error ?? "delivery failed");

    if (result.ok) {
      pending.delete(entry.id);
      entry.state = STATES.DELIVERED;
      entry.deliveredAt = Date.now();
      entry.nextAttemptAt = entry.deliveredAt;
      totals.delivered += 1;
      updateSnapshot(entry, { deliveredAt: entry.deliveredAt });
      logger.debug(
        { webhookId: entry.webhookId, attempts: entry.attempts },
        "[webhook-queue] delivered"
      );
      return;
    }

    if (entry.attempts >= config.maxAttempts) {
      pending.delete(entry.id);
      entry.state = STATES.DEAD_LETTER;
      entry.nextAttemptAt = null;
      deadLetters.set(entry.id, entry);
      evictDeadLetters();
      totals.deadLettered += 1;
      updateSnapshot(entry);
      logger.error(
        {
          webhookId: entry.webhookId,
          deliveryId: entry.id,
          attempts: entry.attempts,
          lastHttpStatus: entry.lastHttpStatus,
          lastError: entry.lastError,
        },
        "[webhook-queue] delivery moved to dead-letter"
      );
      return;
    }

    entry.state = STATES.RETRYING;
    entry.nextAttemptAt = Date.now() + computeBackoffMs(entry.attempts);
    updateSnapshot(entry, { nextAttemptAt: entry.nextAttemptAt });
    logger.warn(
      {
        webhookId: entry.webhookId,
        deliveryId: entry.id,
        attempt: entry.attempts,
        maxAttempts: config.maxAttempts,
        nextAttemptAt: new Date(entry.nextAttemptAt).toISOString(),
        lastHttpStatus: entry.lastHttpStatus,
        lastError: entry.lastError,
      },
      "[webhook-queue] delivery failed — scheduled for retry"
    );
  } finally {
    activeWorkers -= 1;
    scheduleDrain();
  }
}

/** Keep the dead-letter list bounded by evicting the oldest entries. */
function evictDeadLetters() {
  while (deadLetters.size > config.dlqMaxSize) {
    const oldest = deadLetters.keys().next().value;
    deadLetters.delete(oldest);
  }
}

/**
 * Enqueue a delivery for asynchronous processing. Never blocks the caller:
 * the HTTP POST happens in the queue's worker pool, not on the stream path.
 *
 * Duplicate deliveries (same webhook + transaction hash, still queued or
 * dead-lettered) are skipped so Horizon stream replays cannot double-notify.
 *
 * @param {{ id: string, url: string, secret: string }} webhook
 * @param {DeliveryPayload} payload
 * @returns {{ enqueued: boolean, reason?: 'duplicate'|'queue_full', id?: string }}
 */
function enqueueDelivery(webhook, payload) {
  const id = `${webhook.id}:${payload.transactionHash}`;

  if (pending.has(id) || deadLetters.has(id)) {
    totals.duplicates += 1;
    logger.debug(
      { webhookId: webhook.id, deliveryId: id },
      "[webhook-queue] duplicate delivery ignored"
    );
    return { enqueued: false, reason: "duplicate", id };
  }

  if (pending.size >= config.maxSize) {
    totals.rejectedQueueFull += 1;
    logger.warn(
      { webhookId: webhook.id, deliveryId: id, maxSize: config.maxSize },
      "[webhook-queue] queue full — delivery rejected"
    );
    return { enqueued: false, reason: "queue_full", id };
  }

  const now = Date.now();
  /** @type {DeliveryEntry} */
  const entry = {
    id,
    webhookId: webhook.id,
    url: webhook.url,
    secret: webhook.secret,
    payload,
    state: STATES.PENDING,
    attempts: 0,
    nextAttemptAt: now,
    enqueuedAt: now,
    lastAttemptAt: null,
    deliveredAt: null,
    lastHttpStatus: null,
    lastError: null,
  };

  pending.set(id, entry);
  totals.enqueued += 1;
  updateSnapshot(entry);

  logger.debug(
    { webhookId: webhook.id, deliveryId: id },
    "[webhook-queue] delivery enqueued"
  );

  scheduleDrain();
  return { enqueued: true, id };
}

/**
 * Latest known delivery status for a webhook, or null when no delivery has
 * been attempted since process start.
 *
 * @param {string} webhookId
 * @returns {object | null}
 */
function getDeliveryStatus(webhookId) {
  const snapshot = lastDeliveryByWebhook.get(webhookId);
  return snapshot ? { ...snapshot } : null;
}

/**
 * Aggregate queue health for observability.
 *
 * @returns {object}
 */
function getQueueStats() {
  let pendingCount = 0;
  let retryingCount = 0;
  let inFlightCount = 0;
  for (const entry of pending.values()) {
    if (entry.state === STATES.PENDING) pendingCount += 1;
    else if (entry.state === STATES.RETRYING) retryingCount += 1;
    else if (entry.state === STATES.IN_FLIGHT) inFlightCount += 1;
  }

  return {
    pending: pendingCount,
    retrying: retryingCount,
    inFlight: inFlightCount,
    deadLetter: deadLetters.size,
    totals: { ...totals },
    config: { ...config },
  };
}

/**
 * Dead-lettered deliveries, oldest first (secrets stripped).
 *
 * @returns {object[]}
 */
function getDeadLetterEntries() {
  return Array.from(deadLetters.values()).map(sanitizeEntry);
}

/**
 * Requeue a dead-lettered delivery with a fresh retry budget.
 *
 * @param {string} deliveryId
 * @returns {boolean} true if requeued, false if not found
 */
function requeueDeadLetter(deliveryId) {
  const entry = deadLetters.get(deliveryId);
  if (!entry) return false;

  deadLetters.delete(deliveryId);
  entry.state = STATES.PENDING;
  entry.attempts = 0;
  entry.nextAttemptAt = Date.now();
  entry.lastHttpStatus = null;
  entry.lastError = null;
  pending.set(entry.id, entry);
  updateSnapshot(entry);

  logger.info(
    { webhookId: entry.webhookId, deliveryId: entry.id },
    "[webhook-queue] dead-lettered delivery requeued"
  );

  scheduleDrain();
  return true;
}

/**
 * Clear the scheduler timer. In-flight deliveries still complete on their own
 * (each attempt is bounded by the delivery timeout).
 */
function shutdownQueue() {
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
}

/**
 * Reset all queue state — test isolation only.
 */
function resetQueue() {
  shutdownQueue();
  pending.clear();
  deadLetters.clear();
  lastDeliveryByWebhook.clear();
  for (const key of Object.keys(totals)) totals[key] = 0;
  activeWorkers = 0;
}

module.exports = {
  enqueueDelivery,
  getDeliveryStatus,
  getQueueStats,
  getDeadLetterEntries,
  requeueDeadLetter,
  computeBackoffMs,
  shutdownQueue,
  resetQueue,
  STATES,
};

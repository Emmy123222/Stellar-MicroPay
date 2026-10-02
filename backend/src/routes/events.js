/**
 * src/routes/events.js
 * Server-sent events (SSE) endpoint for Soroban contract activity.
 *
 * `GET /api/events/stream` opens a long-lived `text/event-stream` connection and
 * pushes one normalised contract event per message. Every message shares the
 * same envelope so a single `EventSource.onmessage` handler can drive the UI:
 *
 *   { "kind": "ready",  "contractId": "...", "network": "testnet", ... }
 *   { "kind": "event",  "event": { id, type, participants, amount, ledger, ... } }
 *   { "kind": "status", "level": "error", "message": "..." }
 */

"use strict";

const express = require("express");
const router = express.Router();
const eventStreamService = require("../services/eventStreamService");

const HEARTBEAT_INTERVAL_MS = Number(
  process.env.EVENTS_HEARTBEAT_INTERVAL_MS || 15000
);

/** Max events requested from Soroban RPC per poll (RPC caps this at 200). */
const MAX_EVENTS_PER_POLL = 100;

function send(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * GET /api/events/stream
 * Stream contract events for the configured MicroPay contract.
 */
router.get("/stream", (req, res) => {
  const config = eventStreamService.getEventStreamConfig();

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  // Ask the browser to reconnect after 3s rather than the 3s default.
  res.write("retry: 3000\n\n");
  res.write(`: MicroPay event stream · ${config.network}\n\n`);

  send(res, {
    kind: "ready",
    contractId: config.contractId || null,
    network: config.network,
    configured: config.configured,
    message: config.configured
      ? null
      : "CONTRACT_ID is not configured on the server, so no contract events can be streamed.",
  });

  let cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
  let closed = false;
  let pollTimer = null;

  const heartbeatTimer = setInterval(() => {
    if (!closed) res.write(": heartbeat\n\n");
  }, HEARTBEAT_INTERVAL_MS);

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    if (pollTimer) clearTimeout(pollTimer);
    res.end();
  };

  req.on("close", close);
  req.on("error", close);
  res.on("error", close);

  const schedulePoll = () => {
    if (!closed) {
      pollTimer = setTimeout(poll, config.pollIntervalMs);
    }
  };

  async function poll() {
    if (closed) return;

    // Without a contract ID there is nothing to read; stay connected and send
    // heartbeats so the client shows a clear message instead of reconnecting.
    if (!config.configured) {
      schedulePoll();
      return;
    }

    try {
      let startLedger;

      if (!cursor) {
        const latestLedger = await eventStreamService.fetchLatestLedger();
        startLedger = latestLedger
          ? Math.max(1, latestLedger - config.ledgerLookback)
          : 1;
      }

      const page = await eventStreamService.fetchContractEvents({
        contractId: config.contractId,
        startLedger,
        cursor,
        limit: MAX_EVENTS_PER_POLL,
      });

      if (page.cursor) cursor = page.cursor;

      for (const rawEvent of page.events) {
        if (closed) return;
        send(res, {
          kind: "event",
          event: eventStreamService.normalizeContractEvent(rawEvent),
        });
      }
    } catch (err) {
      if (!closed) {
        send(res, {
          kind: "status",
          level: "error",
          message: `Event stream error: ${err.message}`,
        });
      }
    }

    schedulePoll();
  }

  poll();
});

module.exports = router;

/**
 * src/routes/health.js
 * Health check endpoint — used by CI and deployment probes.
 * Includes Horizon circuit breaker status (Issue #1203).
 */

"use strict";

const express = require("express");
const router = express.Router();
const { getCircuitStatus } = require("../middleware/horizonCircuitBreaker");

router.get("/", (req, res) => {
  const circuit = getCircuitStatus();
  res.json({
    status: "ok",
    service: "stellar-micropay-api",
    network: process.env.STELLAR_NETWORK || "testnet",
    timestamp: new Date().toISOString(),
    horizon: {
      circuitState: circuit.state,
      recentFailures: circuit.failures,
      lastOpenedAt: circuit.lastOpenedAt,
    },
  });
});

router.get("/ready", async (req, res) => {
  const url = (process.env.HORIZON_URL || "https://horizon-testnet.stellar.org").replace(/\/$/, "");
  const ok = await fetch(`${url}/`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
  res.status(ok ? 200 : 503).json(ok ? { status: "ok", horizon: "reachable" } : { status: "degraded", horizon: "unreachable" });
});

module.exports = router;

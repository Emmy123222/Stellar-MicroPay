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

module.exports = router;

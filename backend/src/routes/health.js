/**
 * src/routes/health.js
 * Health check endpoint — used by CI and deployment probes.
 */

"use strict";

const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "stellar-micropay-api",
    network: process.env.STELLAR_NETWORK || "testnet",
    timestamp: new Date().toISOString(),
  });
});

router.get("/ready", async (req, res) => {
  const url = (process.env.HORIZON_URL || "https://horizon-testnet.stellar.org").replace(/\/$/, "");
  const ok = await fetch(`${url}/`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
  res.status(ok ? 200 : 503).json(ok ? { status: "ok", horizon: "reachable" } : { status: "degraded", horizon: "unreachable" });
});

module.exports = router;

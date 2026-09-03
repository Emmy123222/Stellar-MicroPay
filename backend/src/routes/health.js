"use strict";

const express = require("express");
const { getAllBreakerStates } = require("../services/horizonCircuitBreaker");
const { getMonitorStatus } = require("../services/paymentMonitor");

const router = express.Router();
const { server } = require("../config/stellar");

router.get("/", (req, res) => {
  const monitor = getMonitorStatus();
  const circuits = getAllBreakerStates();
  const openCircuits = circuits.filter((entry) => entry.state === "open");
  const halfOpenCircuits = circuits.filter((entry) => entry.state === "half_open");

  res.json({
    status: openCircuits.length > 0 ? "degraded" : "ok",
    service: "stellar-micropay-api",
    network: process.env.STELLAR_NETWORK || monitor.network || "testnet",
    timestamp: new Date().toISOString(),
    horizon: {
      url: monitor.horizonUrl,
      network: monitor.network,
      activeStreams: monitor.activeStreams,
      circuits,
      openOrigins: openCircuits.map((entry) => entry.origin),
      halfOpenOrigins: halfOpenCircuits.map((entry) => entry.origin),
    },
  });
});

module.exports = router;
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

module.exports = router;

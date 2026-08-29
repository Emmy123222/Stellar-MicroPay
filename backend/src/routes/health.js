"use strict";

const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");

router.get("/", async (req, res) => {
  let horizonStatus = "unknown";
  try {
    // Minimal load call to check connectivity
    await server.root();
    horizonStatus = "up";
  } catch (err) {
    horizonStatus = "down";
  }

  const isReady = horizonStatus === "up";

  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ok" : "unhealthy",
    service: "stellar-micropay-api",
    network: process.env.STELLAR_NETWORK || "testnet",
    horizon: horizonStatus,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
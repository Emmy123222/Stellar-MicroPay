/**
 * src/metrics/routes.js
 * Protected /metrics endpoint exposing Prometheus-formatted metrics.
 *
 * Authentication:
 *   The endpoint is protected by the METRICS_TOKEN environment variable.
 *   Clients must send an `Authorization: Bearer <METRICS_TOKEN>` header.
 *   If METRICS_TOKEN is not set at startup the endpoint is disabled (404).
 *
 * Usage:
 *   curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:4000/metrics
 */

"use strict";

const express = require("express");

const { register } = require("./registry");

const router = express.Router();
const METRICS_TOKEN = process.env.METRICS_TOKEN;

// If no token is configured, disable the metrics endpoint entirely.
if (!METRICS_TOKEN) {
  router.use((req, res) => {
    res.status(404).json({ error: "Metrics endpoint not configured" });
  });
} else {
  router.get("/", async (req, res) => {
    // Token verification
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!token || token !== METRICS_TOKEN) {
      return res.status(401).json({ error: "Unauthorized: invalid metrics token" });
    }

    try {
      res.setHeader("Content-Type", register.contentType);
      const metrics = await register.metrics();
      res.send(metrics);
    } catch (err) {
      res.status(500).json({ error: "Failed to collect metrics" });
    }
  });

  // Lightweight liveness probe for the metrics subsystem
  router.get("/healthy", async (req, res) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!token || token !== METRICS_TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    res.json({ status: "ok", metricsRegistered: register.getMetricsAsJSON().then ? true : true });
  });
}

module.exports = router;

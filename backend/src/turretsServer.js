/**
 * src/turretsServer.js
 * Sidecar Express server for Stellar Turrets txFunctions endpoints.
 */

"use strict";

const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");

const turretsRoutes = require("./routes/turrets");
const { startRunner } = require("./services/turretsService");

const TURRETS_PORT = Number(process.env.TURRETS_PORT || 4100);

function createTurretsApp() {
  const app = express();

  // Helmet v7+ ships with CSP disabled by default — enable it explicitly.
  // This server is a pure JSON API with no HTML responses, so the policy
  // can be fully locked down.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
        },
      },
    })
  );
  app.use(morgan("tiny"));
  app.use(express.json({ limit: "10kb" }));
  app.use(cors());

  app.get("/health", (req, res) => {
    res.json({ success: true, service: "turrets", status: "ok" });
  });

  app.use("/tx-functions", turretsRoutes);

  app.use((err, req, res, next) => {
    void next;
    const status = err.status || 500;
    res.status(status).json({ error: err.message || "Internal Server Error" });
  });

  return app;
}

function startTurretsServer() {
  const app = createTurretsApp();
  startRunner();

  return app.listen(TURRETS_PORT, () => {
    console.log(`🛡️ Turrets txFunctions server running at http://localhost:${TURRETS_PORT}`);
  });
}

module.exports = { createTurretsApp, startTurretsServer };

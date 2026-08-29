"use strict";

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const Sentry = require("@sentry/node");

const accountRoutes = require("./routes/accounts");
const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payments");
const analyticsRoutes = require("./routes/analytics");
const healthRoutes = require("./routes/health");
const federationRoutes = require("./routes/federation");
const turretsRoutes = require("./routes/turrets");
const tipsRoutes = require("./routes/tips");
const webhookRoutes = require("./routes/webhooks");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");
const { startTurretsServer } = require("./turretsServer");
const { resumeAllMonitors, stopAllMonitoring } = require("./services/paymentMonitor");
const { stopRunner: stopTurretsRunner } = require("./services/turretsService");
const logger = require("./utils/logger");
const { validateEnv } = require("./config/validateEnv");

validateEnv();

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Error message sanitization (#206) ───────────────────────────────────────
const STELLAR_SECRET_PATTERN = /S[A-Z2-7]{55}/g;
function sanitizeMessage(msg) {
  return typeof msg === "string" ? msg.replace(STELLAR_SECRET_PATTERN, "[REDACTED]") : msg;
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
  beforeSend(event) {
    if (event.exception?.values) {
      event.exception.values = event.exception.values.map((v) => ({ ...v, value: sanitizeMessage(v.value) }));
    }
    return event;
  },
});

app.use(Sentry.Handlers.requestHandler());
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameSrc: ["'none'"] } } }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : "*", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(compression());
app.use(pinoHttp({ logger }));

app.use("/api/accounts", accountRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/health", healthRoutes);
app.use("/federation", federationRoutes);
app.use("/api/turrets", turretsRoutes);
app.use("/api/tips", tipsRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(Sentry.Handlers.errorHandler());

const server = app.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
  resumeAllMonitors();
  startTurretsServer();
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info({ signal }, "Graceful shutdown initiated");

  // 1. Stop accepting new traffic
  server.close(() => {
    logger.info("HTTP server closed");
    // 2. Cleanup resources
    stopAllMonitoring();
    stopTurretsRunner();
    process.exit(0);
  });

  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

module.exports = app;
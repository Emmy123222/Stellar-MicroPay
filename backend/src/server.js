"use strict";

const compression = require("compression");
const cookieParser = require("cookie-parser");
const cors = require("cors");
require("dotenv").config();
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const Sentry = require("@sentry/node");
const swaggerUi = require("swagger-ui-express");

const { validateEnv, parseAllowedOrigins } = require("./config/validateEnv");
const { apiDeprecationHeader } = require("./middleware/deprecation");
const accountRoutes = require("./routes/accounts");
const analyticsRoutes = require("./routes/analytics");
const authRoutes = require("./routes/auth");
const federationRoutes = require("./routes/federation");
const healthRoutes = require("./routes/health");
const paymentRoutes = require("./routes/payments");
const tipsRoutes = require("./routes/tips");
const turretsRoutes = require("./routes/turrets");
const webhookRoutes = require("./routes/webhooks");
const { resumeAllMonitors } = require("./services/paymentMonitor");
const swaggerSpec = require("./swagger");
const { startTurretsServer } = require("./turretsServer");
const logger = require("./utils/logger");

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

// Stellar SEP-0001 discovery document. Wallets and SDKs read this file to
// discover the SEP-0002 federation endpoint for `name*domain` addresses.
app.get("/.well-known/stellar.toml", (req, res) => {
  const serverUrl = getFederationServerUrl(req);
  const tomlContent = `# Stellar MicroPay federation discovery
FEDERATION_SERVER="${serverUrl}"
`;

  res.setHeader("Content-Type", "application/toml; charset=utf-8");
  res.send(tomlContent);
});

// Global rate limiting — 100 requests per 15 minutes per IP.
// standardHeaders: true  → emits RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (RFC 6585 draft-7).
// legacyHeaders: false   → suppresses deprecated X-RateLimit-* headers.
// Clients should inspect RateLimit-Remaining and back off when it approaches 0.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// ─── API Versioning & Deprecation Policy (#853) ────────────────────────────────

// Primary Versioned Routes (/api/v1/*)
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/accounts", accountRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/webhooks", webhookRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/turrets", turretsRoutes);
app.use("/api/v1/tips", tipsRoutes);
app.use("/api/v1/health", healthRoutes);

// Legacy Unversioned Routes (/api/*) — includes HTTP Deprecation & Sunset headers
app.use("/api/auth", apiDeprecationHeader, authRoutes);
app.use("/api/accounts", apiDeprecationHeader, accountRoutes);
app.use("/api/payments", apiDeprecationHeader, paymentRoutes);
app.use("/api/webhooks", apiDeprecationHeader, webhookRoutes);
app.use("/api/analytics", apiDeprecationHeader, analyticsRoutes);
app.use("/api/turrets", apiDeprecationHeader, turretsRoutes);
app.use("/api/tips", apiDeprecationHeader, tipsRoutes);
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
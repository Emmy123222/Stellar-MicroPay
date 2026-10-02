/**
 * src/server.js
 * Express server entry point for Stellar MicroPay backend.
 */

"use strict";

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

// ─── Env Validation ───────────────────────────────────────────────────────────
// Must run immediately after dotenv so missing vars are caught before any
// service or route module tries to use them.
const { validateEnv } = require("./validateEnv");
validateEnv();

const accountRoutes = require("./routes/accounts");
const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payments");
const analyticsRoutes = require("./routes/analytics");
const healthRoutes = require("./routes/health");
const federationRoutes = require("./routes/federation");
const turretsRoutes = require("./routes/turrets");
const tipsRoutes = require("./routes/tips");
const webhookRoutes = require("./routes/webhooks");
const networkRoutes = require("./routes/network");
const priceAlertsRoutes = require("./routes/priceAlerts");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");
const { startTurretsServer } = require("./turretsServer");
const { sanitizeRequest } = require("./middleware/sanitization");

const app = express();
const PORT = process.env.PORT || 4000;

/**
 * Attach a correlation id to every request: echo the caller's X-Request-ID
 * when supplied, otherwise generate one. The id is echoed back on the
 * response and available to morgan and the error handler.
 */
function requestId(req, res, next) {
  const supplied = req.headers["x-request-id"];
  req.requestId =
    typeof supplied === "string" && supplied.trim()
      ? supplied.trim()
      : crypto.randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
}

// ─── Middleware ─────────────────────────────────────────────────────────────────

app.use(requestId);
app.use(helmet());
morgan.token("request-id", (req) => req.requestId);
app.use(morgan(":method :url :status :response-time ms requestId=:request-id"));
app.use(express.json({ limit: "10kb" }));

// JSON parsing error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  // Forward other body-parser errors (e.g. 413 payload too large) so they are
  // not silently swallowed and the request does not reach the route handlers.
  next(err);
});

// Global input sanitization — trims strings and rejects null bytes on every
// route. Must be mounted before the route handlers below.
app.use(sanitizeRequest);

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID", "X-Idempotency-Key"],
    exposedHeaders: ["X-Request-ID", "X-Idempotency-Replayed"],
    credentials: true,
    optionsSuccessStatus: 204,
    maxAge: 600,
  })
);

// Global rate limiting — 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/health", healthRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/turrets", turretsRoutes);
app.use("/api/tips", tipsRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/network", networkRoutes);
app.use("/api/price-alerts", priceAlertsRoutes);
app.use("/federation", federationRoutes);

// ─── API Documentation ─────────────────────────────────────────────────────────

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: "Stellar MicroPay API Docs",
  customCss: ".swagger-ui .topbar { display: none }",
  swaggerOptions: { url: "/api/docs.json" },
}));

app.get("/api/docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// ─── Error Handling ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  void next;
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";

  console.error({ requestId: req.requestId, status, message });

  res.status(status).json({ error: message });
});

// ─── Static Files ─────────────────────────────────────────────────────────────

app.get("/.well-known/stellar.toml", (req, res) => {
  const domain = process.env.DOMAIN || "stellarmicropay.com";
  const tomlContent = `[FEDERATION_SERVER]
ACTIVE = true
SERVER = "https://${domain}/federation"
`;
  res.setHeader("Content-Type", "application/toml");
  res.send(tomlContent);
});

// ─── Start ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  // Refuse to start on an insecure configuration rather than serving traffic
  // with a publicly-known signing key.
  validateEnv();

  const server = app.listen(PORT, () => {
    console.log(`
  ✨ Stellar MicroPay API
  🚀 Server running at http://localhost:${PORT}
  🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}
  `);
  });

  startTurretsServer();

  const shutdown = () => {
    console.log("Shutting down... clearing timers.");
    const { stopRunner } = require("./services/turretsService");
    stopRunner();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = app;

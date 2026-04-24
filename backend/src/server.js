/**
 * src/server.js
 * Express server entry point for Stellar MicroPay backend.
 */

"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const accountRoutes = require("./routes/accounts");
const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payments");
const analyticsRoutes = require("./routes/analytics");
const healthRoutes = require("./routes/health");
const federationRoutes = require("./routes/federation");

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "10kb" }));

// JSON parsing error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  next();
});

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
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api/auth",     authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/health",       healthRoutes);

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

app.use("/api/accounts", accountRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/health", healthRoutes);
app.use("/federation", federationRoutes);

// ─── Error Handling ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";

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
  app.listen(PORT, () => {
    console.log(`
  ✨ Stellar MicroPay API
  🚀 Server running at http://localhost:${PORT}
  🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}
  `);
  });
}

module.exports = app;

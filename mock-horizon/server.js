/**
 * mock-horizon/server.js
 * Minimal Express server that mimics the Stellar Horizon API endpoints
 * used by the backend during integration tests.
 *
 * Spun up as its own container via docker-compose.test.yml.
 */

"use strict";

const express = require("express");

const app = express();
const PORT = process.env.PORT || 8000;

// ── Root / capability endpoint ───────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    _links: {
      account: { href: "{base_url}/accounts/{account_id}", templated: true },
      transactions: { href: "{base_url}/transactions{?cursor,limit,order}", templated: true },
    },
    horizon_version: "mock-2.0.0",
    core_version: "mock",
    network_passphrase: "Test SDF Network ; September 2015",
  });
});

// ── Account endpoint ─────────────────────────────────────────────────────────
app.get("/accounts/:accountId", (req, res) => {
  const { accountId } = req.params;

  // Return a minimal Horizon account record
  res.json({
    id: accountId,
    account_id: accountId,
    sequence: "1234567890",
    balances: [
      {
        balance: "100.0000000",
        asset_type: "native",
      },
    ],
    _links: {
      self: { href: `/accounts/${accountId}` },
      transactions: { href: `/accounts/${accountId}/transactions` },
      payments: { href: `/accounts/${accountId}/payments` },
    },
  });
});

// ── Payments endpoint ────────────────────────────────────────────────────────
app.get("/accounts/:accountId/payments", (req, res) => {
  const { accountId } = req.params;

  res.json({
    _links: {
      self: { href: `/accounts/${accountId}/payments` },
      next: { href: "" },
      prev: { href: "" },
    },
    _embedded: {
      records: [
        {
          id: "mock-payment-1",
          type: "payment",
          from: accountId,
          to: "GBMOCK000RECEIVER000000000000000000000000000000000000000",
          amount: "10.0000000",
          asset_type: "native",
          created_at: new Date().toISOString(),
        },
      ],
    },
  });
});

// ── Transactions endpoint ────────────────────────────────────────────────────
app.get("/accounts/:accountId/transactions", (req, res) => {
  res.json({
    _links: { self: { href: "" }, next: { href: "" }, prev: { href: "" } },
    _embedded: { records: [] },
  });
});

// ── Submit transaction ───────────────────────────────────────────────────────
app.post("/transactions", express.urlencoded({ extended: false }), (req, res) => {
  res.status(200).json({
    hash: "mocktxhash0000000000000000000000000000000000000000000000000000",
    ledger: 12345,
    result_xdr: "",
    envelope_xdr: req.body.tx || "",
  });
});

// ── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Mock Horizon server listening on http://0.0.0.0:${PORT}`);
});

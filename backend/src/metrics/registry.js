/**
 * src/metrics/registry.js
 * Central prom-client registry for Stellar MicroPay backend observability (#839).
 *
 * All metrics are defined here and imported by services/middleware that need
 * to record them. The registry is also used by the /metrics endpoint to
 * serialise the exposition format.
 */

"use strict";

const { Registry, Counter, Histogram, Gauge } = require("prom-client");

const register = new Registry();

// ─── Default labels (applied to every metric) ────────────────────────────────

register.setDefaultLabels({
  app: "stellar-micropay",
  network: process.env.STELLAR_NETWORK || "testnet",
});

// ─── HTTP request metrics (middleware) ────────────────────────────────────────

const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests processed",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestErrors = new Counter({
  name: "http_request_errors_total",
  help: "Total number of HTTP requests that resulted in 4xx/5xx responses",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

// ─── Horizon API call metrics (stellarService) ───────────────────────────────

const horizonCallsTotal = new Counter({
  name: "horizon_calls_total",
  help: "Total number of Horizon API calls",
  labelNames: ["operation", "status"],
  registers: [register],
});

const horizonCallDuration = new Histogram({
  name: "horizon_call_duration_seconds",
  help: "Horizon API call latency in seconds",
  labelNames: ["operation"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

const horizonRetriesTotal = new Counter({
  name: "horizon_retries_total",
  help: "Total number of Horizon API call retries",
  labelNames: ["operation"],
  registers: [register],
});

const horizonErrorsTotal = new Counter({
  name: "horizon_errors_total",
  help: "Total number of Horizon API call errors (non-retryable)",
  labelNames: ["operation", "status"],
  registers: [register],
});

// ─── Webhook metrics (webhookDelivery) ───────────────────────────────────────

const webhookDeliveriesTotal = new Counter({
  name: "webhook_deliveries_total",
  help: "Total number of webhook delivery attempts",
  labelNames: ["status"],
  registers: [register],
});

const webhookDeliveryDuration = new Histogram({
  name: "webhook_delivery_duration_seconds",
  help: "Webhook delivery latency in seconds",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const webhookDeliveryErrorsTotal = new Counter({
  name: "webhook_delivery_errors_total",
  help: "Total number of webhook delivery failures",
  labelNames: ["reason"],
  registers: [register],
});

const webhookDeliveriesRetried = new Counter({
  name: "webhook_deliveries_retried_total",
  help: "Total number of webhook delivery retries",
  registers: [register],
});

// ─── SSE stream metrics (paymentMonitor) ─────────────────────────────────────

const activeStreams = new Gauge({
  name: "active_sse_streams",
  help: "Number of currently active Horizon SSE payment streams",
  registers: [register],
});

const streamErrorsTotal = new Counter({
  name: "stream_errors_total",
  help: "Total number of SSE stream errors",
  registers: [register],
});

// ─── Scheduled transaction metrics (scheduledTransactionService) ─────────────

const scheduledTxQueueDepth = new Gauge({
  name: "scheduled_tx_queue_depth",
  help: "Number of pending scheduled transactions in the queue",
  registers: [register],
});

const scheduledTxDueTotal = new Counter({
  name: "scheduled_tx_due_total",
  help: "Total number of scheduled transactions that became due for submission",
  registers: [register],
});

const scheduledTxSubmitTotal = new Counter({
  name: "scheduled_tx_submit_total",
  help: "Total number of scheduled transaction submission attempts",
  labelNames: ["status"],
  registers: [register],
});

// ─── Turrets execution metrics (turretsService) ─────────────────────────────

const turretsExecutionsTotal = new Counter({
  name: "turrets_executions_total",
  help: "Total number of Turrets txFunction executions",
  labelNames: ["type", "status"],
  registers: [register],
});

const turretsExecutionDuration = new Histogram({
  name: "turrets_execution_duration_seconds",
  help: "Turrets txFunction evaluation latency in seconds",
  labelNames: ["type"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const turretsDeploymentsTotal = new Counter({
  name: "turrets_deployments_total",
  help: "Total number of Turrets deployment operations",
  labelNames: ["type"],
  registers: [register],
});

const turretsActiveDeployments = new Gauge({
  name: "turrets_active_deployments",
  help: "Number of currently active Turrets deployments",
  registers: [register],
});

module.exports = {
  register,

  // HTTP
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestErrors,

  // Horizon
  horizonCallsTotal,
  horizonCallDuration,
  horizonRetriesTotal,
  horizonErrorsTotal,

  // Webhooks
  webhookDeliveriesTotal,
  webhookDeliveryDuration,
  webhookDeliveryErrorsTotal,
  webhookDeliveriesRetried,

  // SSE streams
  activeStreams,
  streamErrorsTotal,

  // Scheduled transactions
  scheduledTxQueueDepth,
  scheduledTxDueTotal,
  scheduledTxSubmitTotal,

  // Turrets
  turretsExecutionsTotal,
  turretsExecutionDuration,
  turretsDeploymentsTotal,
  turretsActiveDeployments,
};

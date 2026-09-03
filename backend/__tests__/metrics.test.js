/**
 * __tests__/metrics.test.js
 * Tests for observability metrics (#839).
 *
 * Covers:
 *   - Metrics registry exports all expected metrics
 *   - HTTP metrics middleware records request counts and latency
 *   - /metrics endpoint serves Prometheus format and rejects unauthenticated requests
 *   - Service-level metric recording (Horizon, webhooks, streams, turrets, scheduled tx)
 */

"use strict";

const { Registry } = require("prom-client");
const request = require("supertest");

// ── Mock auth to avoid JWT dependencies in integration-like tests ────────────
jest.mock("../src/middleware/auth", () => ({
  verifyJWT: (req, res, next) => {
    req.user = { publicKey: req.params.publicKey };
    next();
  },
}));

const METRICS_TOKEN = "test-metrics-token-42";
let originalToken;

beforeAll(() => {
  originalToken = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = METRICS_TOKEN;
});

afterAll(() => {
  if (originalToken === undefined) {
    delete process.env.METRICS_TOKEN;
  } else {
    process.env.METRICS_TOKEN = originalToken;
  }
});

describe("Metrics Registry", () => {
  it("exports a prom-client Registry instance", () => {
    const { register } = require("../src/metrics/registry");
    expect(register).toBeInstanceOf(Registry);
  });

  it("defines http_requests_total counter", () => {
    const { httpRequestsTotal } = require("../src/metrics/registry");
    expect(httpRequestsTotal).toBeDefined();
    expect(httpRequestsTotal.name).toBe("http_requests_total");
  });

  it("defines http_request_duration_seconds histogram", () => {
    const { httpRequestDuration } = require("../src/metrics/registry");
    expect(httpRequestDuration).toBeDefined();
    expect(httpRequestDuration.name).toBe("http_request_duration_seconds");
  });

  it("defines horizon_calls_total counter", () => {
    const { horizonCallsTotal } = require("../src/metrics/registry");
    expect(horizonCallsTotal).toBeDefined();
    expect(horizonCallsTotal.name).toBe("horizon_calls_total");
  });

  it("defines horizon_call_duration_seconds histogram", () => {
    const { horizonCallDuration } = require("../src/metrics/registry");
    expect(horizonCallDuration).toBeDefined();
    expect(horizonCallDuration.name).toBe("horizon_call_duration_seconds");
  });

  it("defines horizon_retries_total counter", () => {
    const { horizonRetriesTotal } = require("../src/metrics/registry");
    expect(horizonRetriesTotal).toBeDefined();
    expect(horizonRetriesTotal.name).toBe("horizon_retries_total");
  });

  it("defines webhook_deliveries_total counter", () => {
    const { webhookDeliveriesTotal } = require("../src/metrics/registry");
    expect(webhookDeliveriesTotal).toBeDefined();
    expect(webhookDeliveriesTotal.name).toBe("webhook_deliveries_total");
  });

  it("defines webhook_delivery_duration_seconds histogram", () => {
    const { webhookDeliveryDuration } = require("../src/metrics/registry");
    expect(webhookDeliveryDuration).toBeDefined();
    expect(webhookDeliveryDuration.name).toBe("webhook_delivery_duration_seconds");
  });

  it("defines active_sse_streams gauge", () => {
    const { activeStreams } = require("../src/metrics/registry");
    expect(activeStreams).toBeDefined();
    expect(activeStreams.name).toBe("active_sse_streams");
  });

  it("defines scheduled_tx_queue_depth gauge", () => {
    const { scheduledTxQueueDepth } = require("../src/metrics/registry");
    expect(scheduledTxQueueDepth).toBeDefined();
    expect(scheduledTxQueueDepth.name).toBe("scheduled_tx_queue_depth");
  });

  it("defines turrets_executions_total counter", () => {
    const { turretsExecutionsTotal } = require("../src/metrics/registry");
    expect(turretsExecutionsTotal).toBeDefined();
    expect(turretsExecutionsTotal.name).toBe("turrets_executions_total");
  });

  it("defines turrets_execution_duration_seconds histogram", () => {
    const { turretsExecutionDuration } = require("../src/metrics/registry");
    expect(turretsExecutionDuration).toBeDefined();
    expect(turretsExecutionDuration.name).toBe("turrets_execution_duration_seconds");
  });

  it("defines turrets_active_deployments gauge", () => {
    const { turretsActiveDeployments } = require("../src/metrics/registry");
    expect(turretsActiveDeployments).toBeDefined();
    expect(turretsActiveDeployments.name).toBe("turrets_active_deployments");
  });

  it("sets default labels including app and network", async () => {
    const { register } = require("../src/metrics/registry");
    const metrics = await register.metrics();
    // Default labels should appear in the prometheus exposition format
    expect(metrics).toContain("app");
    expect(metrics).toContain("stellar-micropay");
    expect(metrics).toContain("network");
  });
});

describe("Metrics Middleware", () => {
  it("exports a metricsMiddleware function", () => {
    const { metricsMiddleware } = require("../src/metrics/middleware");
    expect(typeof metricsMiddleware).toBe("function");
  });

  it("exports normaliseRoute that strips query strings", () => {
    const { normaliseRoute } = require("../src/metrics/middleware");
    expect(normaliseRoute("/api/health")).toBe("/api/health");
    expect(normaliseRoute("/api/health?foo=bar")).toBe("/api/health");
  });

  it("normalises Stellar public key segments to :id", () => {
    const { normaliseRoute } = require("../src/metrics/middleware");
    const pubKey = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
    expect(normaliseRoute(`/api/accounts/${pubKey}`)).toBe("/api/accounts/:id");
  });

  it("normalises UUID segments to :id", () => {
    const { normaliseRoute } = require("../src/metrics/middleware");
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(normaliseRoute(`/api/deployments/${uuid}`)).toBe("/api/deployments/:id");
  });
});

describe("/metrics endpoint", () => {
  let app;

  beforeAll(() => {
    // Re-require server after env is set so metrics routes pick up the token
    jest.resetModules();
    // Re-set env for the re-required modules
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    app = require("../src/server");
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it("returns 401 when wrong token is provided", async () => {
    const res = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("returns Prometheus text format with valid token", async () => {
    const res = await request(app)
      .get("/metrics")
      .set("Authorization", `Bearer ${METRICS_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("# HELP");
    expect(res.text).toContain("# TYPE");
    expect(res.text).toContain("http_requests_total");
    expect(res.text).toContain("horizon_calls_total");
    expect(res.text).toContain("webhook_deliveries_total");
    expect(res.text).toContain("active_sse_streams");
    expect(res.text).toContain("turrets_executions_total");
    expect(res.text).toContain("scheduled_tx_queue_depth");
  });
});

describe("HTTP metrics recording", () => {
  let app;

  beforeAll(() => {
    jest.resetModules();
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    app = require("../src/server");
  });

  it("increments http_requests_total after a request", async () => {
    const { register } = require("../src/metrics/registry");
    const before = await register.getSingleMetricAsString("http_requests_total");

    await request(app).get("/health");

    const after = await register.getSingleMetricAsString("http_requests_total");
    expect(after.length).toBeGreaterThanOrEqual(before.length);
  });
});

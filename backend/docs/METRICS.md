# Backend Observability Metrics (#839)

## Overview

Stellar MicroPay exposes Prometheus-formatted metrics at the `/metrics` endpoint.
All metrics carry default labels `app=stellar-micropay` and `network=<STELLAR_NETWORK>`.

## Authentication

The `/metrics` endpoint is protected by a bearer token:

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:4000/metrics
```

If `METRICS_TOKEN` is not set, the endpoint returns 404.

---

## Metric Reference

### HTTP Request Metrics (Middleware)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `method`, `route`, `status` | Total HTTP requests processed |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Request latency in seconds |
| `http_request_errors_total` | Counter | `method`, `route`, `status` | Requests returning 4xx/5xx |

**Buckets:** 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s

**Recommended Alert Thresholds:**

| Alert | Condition | Severity |
|-------|-----------|----------|
| High error rate | `rate(http_request_errors_total[5m]) / rate(http_requests_total[5m]) > 0.05` | Warning |
| Elevated error rate | `rate(http_request_errors_total[5m]) / rate(http_requests_total[5m]) > 0.10` | Critical |
| High latency (p95) | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2` | Warning |
| Very high latency (p99) | `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 5` | Critical |

---

### Horizon API Metrics (stellarService)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `horizon_calls_total` | Counter | `operation`, `status` | Total Horizon API calls |
| `horizon_call_duration_seconds` | Histogram | `operation` | Horizon call latency in seconds |
| `horizon_retries_total` | Counter | `operation` | Total retry attempts |
| `horizon_errors_total` | Counter | `operation`, `status` | Non-retryable Horizon errors |

**Operations:** `loadAccount`, `payments`, `transaction`, `stream`

**Recommended Alert Thresholds:**

| Alert | Condition | Severity |
|-------|-----------|----------|
| High Horizon error rate | `rate(horizon_errors_total[5m]) > 0.5` | Warning |
| Horizon circuit breaker | `rate(horizon_errors_total[5m]) > 2` | Critical |
| Excessive retries | `rate(horizon_retries_total[5m]) > 1` | Warning |
| Horizon slow calls (p95) | `histogram_quantile(0.95, rate(horizon_call_duration_seconds_bucket[5m])) > 5` | Warning |

---

### Webhook Delivery Metrics (webhookDelivery)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `webhook_deliveries_total` | Counter | `status` | Total delivery attempts by HTTP status |
| `webhook_delivery_duration_seconds` | Histogram | — | Delivery round-trip latency |
| `webhook_delivery_errors_total` | Counter | `reason` | Delivery failures (network errors) |
| `webhook_deliveries_retried_total` | Counter | — | Total delivery retries |

**Buckets:** 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s

**Recommended Alert Thresholds:**

| Alert | Condition | Severity |
|-------|-----------|----------|
| High webhook failure rate | `rate(webhook_deliveries_total{status=~"5..|error"}[5m]) / rate(webhook_deliveries_total[5m]) > 0.10` | Warning |
| Webhook delivery breakdown | `rate(webhook_deliveries_total{status=~"5..|error"}[5m]) / rate(webhook_deliveries_total[5m]) > 0.25` | Critical |
| Slow webhook deliveries (p95) | `histogram_quantile(0.95, rate(webhook_delivery_duration_seconds_bucket[5m])) > 3` | Warning |

---

### SSE Stream Metrics (paymentMonitor)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `active_sse_streams` | Gauge | — | Currently active Horizon SSE streams |
| `stream_errors_total` | Counter | — | Total SSE stream errors |

**Recommended Alert Thresholds:**

| Alert | Condition | Severity |
|-------|-----------|----------|
| Stream errors | `rate(stream_errors_total[5m]) > 0` | Warning |
| Stream errors sustained | `rate(stream_errors_total[5m]) > 1` | Critical |
| No active streams (when expected) | `active_sse_streams == 0` (if webhooks registered) | Warning |

---

### Scheduled Transaction Metrics (scheduledTransactionService)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `scheduled_tx_queue_depth` | Gauge | — | Pending scheduled transactions |
| `scheduled_tx_due_total` | Counter | — | Transactions that became due |
| `scheduled_tx_submit_total` | Counter | `status` | Submission attempts (`ok`, `error`) |

**Recommended Alert Thresholds:**

| Alert | Condition | Severity |
|-------|-----------|----------|
| Queue depth growing | `scheduled_tx_queue_depth > 100` | Warning |
| Queue backlog | `scheduled_tx_queue_depth > 500` | Critical |
| High submission error rate | `rate(scheduled_tx_submit_total{status="error"}[5m]) / rate(scheduled_tx_submit_total[5m]) > 0.20` | Warning |

---

### Turrets Execution Metrics (turretsService)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `turrets_executions_total` | Counter | `type`, `status` | txFunction evaluations |
| `turrets_execution_duration_seconds` | Histogram | `type` | Evaluation latency |
| `turrets_deployments_total` | Counter | `type` | Total deployment operations |
| `turrets_active_deployments` | Gauge | — | Currently active deployments |

**Types:** `dca`, `stop_loss`, `escrow_release`
**Statuses:** `executed`, `skipped`, `completed`, `pending`, `error`

**Recommended Alert Thresholds:**

| Alert | Condition | Severity |
|-------|-----------|----------|
| Turrets execution errors | `rate(turrets_executions_total{status="error"}[5m]) > 0` | Warning |
| High error rate | `rate(turrets_executions_total{status="error"}[5m]) > 1` | Critical |
| Slow execution (p95) | `histogram_quantile(0.95, rate(turrets_execution_duration_seconds_bucket[5m])) > 5` | Warning |

---

## Prometheus Configuration Example

```yaml
scrape_configs:
  - job_name: "stellar-micropay"
    bearer_token: "${METRICS_TOKEN}"
    scrape_interval: 15s
    static_configs:
      - targets: ["localhost:4000"]
    metrics_path: /metrics
```

## Grafana Dashboard Import

Use these metric names to build dashboards. The `/metrics` endpoint returns
standard Prometheus exposition format — compatible with any Prometheus-compatible
tool (Grafana, Datadog, CloudWatch, etc.).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `METRICS_TOKEN` | Yes | Bearer token for `/metrics` endpoint access. If unset, endpoint returns 404. |
| `STELLAR_NETWORK` | Yes | Included as a default label on all metrics (`testnet` or `mainnet`). |

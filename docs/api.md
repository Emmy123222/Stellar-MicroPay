# API Documentation — Stellar MicroPay

Base URL: `http://localhost:4000`

All responses follow the format:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "message" }
```

## Request Correlation

Every response carries an `X-Request-ID` header. The value is taken from the
inbound `X-Request-ID` request header when it is well formed, otherwise the
server generates a UUID. The same value is repeated as `requestId` in error
bodies that pass through the central error handler, and appears on every access
log line:

```
GET /api/accounts/G... 200 12.481 ms - 9f1c2b7e-5a44-4d0e-9a0e-2c1d3e4f5a6b
```

Client-supplied IDs are only echoed when they match `[A-Za-z0-9._:-]{1,128}`.
Anything else is discarded and replaced, so a hostile header cannot inject
content into the logs.

---

## Health

### `GET /health`

Check that the API server is running.

**Response**
```json
{
  "status": "ok",
  "service": "stellar-micropay-api",
  "network": "testnet",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## Accounts

### `GET /api/accounts/:publicKey`

Fetch account info and all token balances.

**Parameters**
| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar G... public key |

**Response**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC...XYZ",
    "sequence": "12345678",
    "subentryCount": 0,
    "balances": [
      { "assetCode": "XLM", "balance": "9999.9999900", "asset_type": "native" }
    ]
  }
}
```

**Errors**
| Status | Meaning |
|--------|---------|
| 400 | Invalid public key format |
| 404 | Account not found / unfunded |

---

### `GET /api/accounts/:publicKey/balance`

Fetch only the native XLM balance.

**Response**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC...XYZ",
    "xlm": "9999.9999900"
  }
}
```

---

### `GET /api/accounts/resolve/:username`

> ⚠️ **Not yet implemented** — see ROADMAP.md v1.2

Resolve a username (e.g. `alice`) to a Stellar public key.

**Response (501)**
```json
{
  "success": false,
  "error": "Username resolution is not yet implemented.",
  "docs": "See ROADMAP.md for v1.2 — Username Payments"
}
```

---

## Payments

### `GET /api/payments/:publicKey`

Fetch payment history for an account.

**Parameters**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| publicKey | path | — | Stellar public key |
| limit | query | 20 | Max results (max 100) |
| cursor | query | — | Pagination cursor |

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "operation-id",
      "type": "sent",
      "amount": "10.0000000",
      "asset": "XLM",
      "from": "GABC...SENDER",
      "to": "GXYZ...RECIPIENT",
      "memo": "Coffee ☕",
      "createdAt": "2025-01-01T12:00:00Z",
      "transactionHash": "abc123...",
      "pagingToken": "..."
    }
  ]
}
```

---

### `GET /api/payments/:publicKey/stats`

Return aggregate statistics for an account.

**Response**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC...XYZ",
    "totalSentXLM": "150.0000000",
    "totalReceivedXLM": "75.0000000",
    "sentCount": 12,
    "receivedCount": 5,
    "totalTransactions": 17
  }
}
```

---

## Rate Limiting

Two tiers are applied. A global limit of **100 requests per 15 minutes** per IP
covers every route, and a stricter limit of **20 requests per minute** covers
sensitive lookups — accounts, payments, analytics and tips. When the global
limit is exceeded the API returns:

```json
{ "error": "Too many requests, please try again later." }
```

When the stricter limit is exceeded:

```json
{ "error": "Too many requests to sensitive routes, please wait 1 minute." }
```

Both tiers are configurable via `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` and
`STRICT_RATE_LIMIT_MAX` / `STRICT_RATE_LIMIT_WINDOW_MS`.

---

## Horizon Circuit Breaker

Outbound calls to Stellar Horizon are guarded by a circuit breaker. After
`HORIZON_BREAKER_FAILURE_THRESHOLD` consecutive failures (default `5`) the
circuit opens and further Horizon-backed requests are rejected immediately with
`503`, without waiting on Horizon. After `HORIZON_BREAKER_RESET_TIMEOUT`
milliseconds (default `30000`) a single probe request is allowed through:
success closes the circuit, failure re-opens it.

A `404` from Horizon is **not** treated as a failure — it is a legitimate
answer for an account that exists but is not funded on the current network.

**Response while the circuit is open**
```json
{
  "error": "Stellar Horizon is temporarily unavailable. Please try again shortly.",
  "requestId": "9f1c2b7e-5a44-4d0e-9a0e-2c1d3e4f5a6b"
}
```

Affects: `/api/accounts/:publicKey`, `/api/accounts/:publicKey/balance`,
`/api/payments/:publicKey`, `/api/payments/:publicKey/stats`, and the three
`/api/analytics/:publicKey/*` endpoints.

---

## Tips

### `GET /api/tips/leaderboard`

Top creators ranked by total amount tipped, highest first.

**Query Parameters**
| Name | Type | Description |
|------|------|-------------|
| limit | integer | Maximum entries to return (default `10`, minimum `1`) |

`limit` must be a positive integer. A fractional value (`1.9`), a value with
trailing characters (`1abc`), exponent or hex notation, an empty value, or a
repeated `?limit=` parameter is rejected rather than coerced.

### Pagination on `/api/tips/received/:creatorPublicKey` and `/api/tips/sent/:senderPublicKey`

These accept the same `limit` (default `50`, minimum `1`) plus `offset`
(default `0`, minimum `0`). Both are validated strictly, for the same reason:
a malformed value is a `400`, not a silently coerced page.

**Response**
```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "creatorPublicKey": "G...",
        "totalTips": 12,
        "totalByAsset": { "XLM": { "count": 12, "amount": "340.5" } },
        "totalAmount": "340.5",
        "averageTip": "28.375",
        "largestTip": "100"
      }
    ],
    "totalCreators": 4,
    "limit": 10
  }
}
```

A `limit` that is not a positive integer returns `400` with
`"limit must be a positive integer"`.

---

## Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad request (invalid input, including malformed Stellar public keys) |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 501 | Feature not yet implemented |
| 503 | Stellar Horizon unavailable (circuit breaker open) |

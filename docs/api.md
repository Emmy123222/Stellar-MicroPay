# API Documentation — Stellar MicroPay

**Base URL:** `http://localhost:4000` (default; override with `PORT`)

**Versioned Base URL:** `http://localhost:4000/api/v1`

**Interactive docs:** [Swagger UI](http://localhost:4000/api/docs) · [OpenAPI JSON](http://localhost:4000/api/docs.json)

**Client examples:** [TypeScript & Python](./sdk-examples.md)

---

## API Versioning Strategy & Deprecation Policy (#853)

All primary API routes are versioned under the `/api/v1/` prefix:
- `http://localhost:4000/api/v1/auth`
- `http://localhost:4000/api/v1/accounts`
- `http://localhost:4000/api/v1/payments`
- `http://localhost:4000/api/v1/webhooks`
- `http://localhost:4000/api/v1/analytics`
- `http://localhost:4000/api/v1/turrets`
- `http://localhost:4000/api/v1/tips`
- `http://localhost:4000/api/v1/health`

### Deprecation & Sunset Headers
Legacy unversioned endpoints (`/api/*`) are maintained for backward compatibility. Whenever a client calls a legacy unversioned endpoint, the API server includes standard HTTP Deprecation and Sunset headers (RFC 8594 / IETF RFC draft):

```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sun, 31 Dec 2028 23:59:59 GMT
Link: </api/v1/accounts/resolve/alice>; rel="successor-version"
```

- **`Deprecation: true`**: Signals that the requested URL path is deprecated.
- **`Sunset: <HTTP-date>`**: Specifies the date after which the legacy endpoint will be permanently retired.
- **`Link: <URI>; rel="successor-version"`**: Points directly to the versioned replacement endpoint.

### Migration Example for Breaking Changes

When upgrading client code to handle breaking contract changes:

#### Legacy Call (Deprecated)
```bash
curl -X GET http://localhost:4000/api/accounts/resolve/alice
```
*Returns deprecation headers and will be retired at Sunset.*

#### Updated Call (Versioned)
```bash
curl -X GET http://localhost:4000/api/v1/accounts/resolve/alice
```
*Guarantees stable v1 contract without deprecation warnings.*

---

## Soroban event schema versioning

Contract events use event-data schema version `1`. The first item in every
non-indexed event data tuple is `schema_version: u32`; event names and indexed
topics remain stable across payload revisions. Indexers should select a decoder
from this field and reject or quarantine versions they do not understand.

| Event | Indexed topics | Version 1 event data |
|-------|----------------|----------------------|
| `init` | `(init)` | `(1, admin)` |
| `tip` | `(tip, from, to)` | `(1, amount)` |
| `receipt` | `(receipt, from)` | `(1, receipt_index)` |
| `escrow_create` | `(escrow_create, escrow_id)` | `(1, from, to, amount, release_ledger)` |
| `escrow_claim` | `(escrow_claim, escrow_id)` | `(1, to, amount)` |
| `escrow_cancel` | `(escrow_cancel, escrow_id)` | `(1, from, amount)` |
| `stream_open` | `(stream_open, stream_id)` | `(1, payer, recipients, weights, rate_per_ledger, deposit)` |
| `stream_claim` | `(stream_claim, stream_id)` | `(1, recipient, amount)` |
| `stream_topup` | `(stream_topup, stream_id)` | `(1, payer, amount, total_deposited)` |
| `stream_pause` | `(stream_pause, stream_id)` | `(1, payer, paused_at_ledger)` |
| `stream_resume` | `(stream_resume, stream_id)` | `(1, payer, pause_length)` |
| `stream_close` | `(stream_close, stream_id)` | `(1, paid_to_recipients, payer_refund)` |
| `migrate` | `(migrate)` | `(1, from_storage_version, to_storage_version)` |

### JavaScript decoding example

```ts
import { scValToNative } from "@stellar/stellar-sdk";

function decodeMicroPayEvent(event) {
  const topics = event.topic.map(scValToNative);
  const [schemaVersion, ...payload] = scValToNative(event.value);

  if (schemaVersion !== 1) {
    throw new Error(`Unsupported MicroPay event schema: ${schemaVersion}`);
  }

  return { name: topics[0], indexedTopics: topics.slice(1), payload };
}
```

For example, `escrow_claim` decodes to indexed topics `[escrow_id]` and
payload `[to, amount]`; `stream_close` decodes to indexed topics `[stream_id]`
and payload `[paid_to_recipients, payer_refund]`.

The layout is network-independent. Testnet and mainnet emit the same schema;
indexers must configure the correct network passphrase, RPC endpoint, and
deployed contract ID for each network and must not merge their cursors.

---

## Response conventions

Most JSON endpoints use one of these shapes:

**Success (typical)**
```json
{ "success": true, "data": { } }
```

**Success with message**
```json
{ "success": true, "data": { }, "message": "..." }
```

**Error**
```json
{ "error": "Human-readable message" }
```

**Error response rule:** All error responses (4xx and 5xx) use the `{ "error": "..." }` shape consistently. The `success` field is omitted from error responses — clients should check the HTTP status code instead.

Some endpoints return a flat success object without the `success` / `data` wrapper. These are intentional exceptions documented below:

| Endpoint | Reason |
|----------|--------|
| `GET /health`, `GET /api/health` | Health checks return minimal flat JSON for liveness probes |
| `GET /federation` | SEP-0002 federation responses follow the Stellar protocol spec |
| `GET /api/auth` | SEP-0010 challenge returns raw XDR for client-side signing |

**Authentication:** Account detail routes require a JWT from [SEP-0010 auth](#authentication). Send:

```
Authorization: Bearer <token>
```

---

## Rate limiting

| Limiter | Window | Limit | Applies to |
|---------|--------|-------|------------|
| Global | 15 minutes | 100 req/IP | All routes **except** `/health` and `/api/health` |
| Payment | 1 minute | 10 req/IP | `/api/payments/*`, `/api/turrets/*` |
| Read-only | 1 minute | 20 req/IP | `/api/accounts/register`, `/federation`, `/api/analytics/*`, `/api/tips/*` |

Responses include `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers.

| Status | Body |
|--------|------|
| 429 (global) | `{ "error": "Too many requests, please try again later." }` |
| 429 (sensitive) | `{ "error": "Too many requests to this endpoint, please wait 1 minute." }` |
| 429 (read-only) | `{ "error": "Too many requests to sensitive routes, please wait 1 minute." }` |
| 429 (payment) | `{ "error": "Too many requests to payment/turret routes, please wait 1 minute." }` |

---

## Table of contents

- [Health](#health)
- [API documentation](#api-documentation)
- [Authentication](#authentication)
- [Stellar federation](#stellar-federation)
- [Accounts](#accounts)
- [Payments](#payments)
- [Analytics](#analytics)
- [Tips](#tips)
- [Turrets (txFunctions)](#turrets-txfunctions)
- [Webhooks](#webhooks)
- [Global errors](#global-errors)

---

## Health

### `GET /health`

### `GET /api/health`

Liveness probe. **Not** subject to global rate limiting.

**Response `200`**
```json
{
  "status": "ok",
  "service": "stellar-micropay-api",
  "network": "testnet",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| status | string | Always `"ok"` when healthy |
| service | string | Service identifier |
| network | string | `STELLAR_NETWORK` env or `"testnet"` |
| timestamp | string (ISO 8601) | Server time |

---

## API documentation

### `GET /api/docs`

Serves Swagger UI (HTML).

### `GET /api/docs.json`

Returns the OpenAPI 3.0 specification as JSON.

**Response `200`** — OpenAPI document (large JSON object).

---

## Authentication

SEP-0010 Stellar Web Authentication.

### `GET /api/auth`

Issue a challenge transaction for the client to sign.

**Query parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| account | string | yes | Stellar public key (`G` + 55 alphanumerics) |

**Response `200`**
```json
{
  "transaction": "<base64 XDR>",
  "networkPassphrase": "Test SDF Network ; September 2015"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Missing account query parameter" }` |
| 400 | `{ "error": "<validation message>" }` |

---

### `POST /api/auth`

Verify a signed challenge and issue a JWT (also set as `httpOnly` cookie `jwt`).

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| transaction | string | yes | Signed challenge XDR (base64) |

**Example request**
```json
{
  "transaction": "AAAAAgAAAAC..."
}
```

**Response `200`**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Missing transaction in request body" }` |
| 401 | `{ "error": "Unauthorized: <reason>" }` |

---

## Stellar federation

### `GET /.well-known/stellar.toml`

SEP-0001 discovery document (TOML, not JSON).

**Response `200`** (`Content-Type: application/toml`)
```toml
# Stellar MicroPay federation discovery
FEDERATION_SERVER="http://localhost:4000/federation"
```

---

### `GET /federation`

SEP-0002 federation resolver. Subject to **read-only** rate limit.

**Query parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| q | string | yes | For `type=name`: `username*domain`; for `type=id`: Stellar account ID (`G...`) |
| type | string | yes | `"name"` or `"id"` |

**Response `200` (type=name)**
```json
{
  "stellar_address": "alice*stellarmicropay.io",
  "account_id": "GABC1234567890123456789012345678901234567890123456789012345"
}
```

**Response `200` (type=id)**
```json
{
  "stellar_address": "alice*stellarmicropay.io",
  "account_id": "GABC1234567890123456789012345678901234567890123456789012345"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Missing required parameters: q and type" }` |
| 400 | `{ "error": "Invalid required parameters: q and type must be strings" }` |
| 400 | `{ "error": "Invalid type parameter. Must be 'name' or 'id'" }` |
| 400 | `{ "error": "Invalid stellar address format" }` |
| 404 | `{ "error": "Not found" }` |
| 404 | `{ "error": "Account ID not found" }` |

---

## Accounts

### `GET /api/accounts/resolve/:username`

Resolve a registered username to a public key. Subject to **sensitive** rate limit.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| username | string | 3–20 alphanumeric characters (trimmed and lowercased) |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "username": "alice",
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345"
  }
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Username is required" }` |
| 400 | `{ "error": "Username must be 3-20 characters long and contain only letters and numbers" }` |
| 404 | `{ "error": "Username not found" }` |

---

### `POST /api/accounts/register`

Register a username for a Stellar public key. Subject to **read-only** rate limit.

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| username | string | yes | 3–20 alphanumeric characters |
| publicKey | string | yes | Stellar `G...` public key (56 chars) |

**Example request**
```json
{
  "username": "alice",
  "publicKey": "GABC1234567890123456789012345678901234567890123456789012345"
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "username": "alice",
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345"
  },
  "message": "Username registered successfully"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "success": false, "error": "Username and public key are required" }` |
| 400 | `{ "error": "Invalid Stellar public key format" }` |
| 409 | `{ "error": "Username already registered" }` |
| 409 | `{ "error": "Public key already registered to another username" }` |

---

### `GET /api/accounts/:publicKey`

Fetch account info and balances from Horizon. Requires JWT; caller may only access their own key. Subject to **sensitive** rate limit.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key (56 chars) |

**Headers**

| Name | Value |
|------|-------|
| Authorization | `Bearer <jwt>` |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "sequence": "12345678",
    "subentryCount": 0,
    "balances": [
      {
        "assetCode": "XLM",
        "balance": "9999.9999900",
        "asset_type": "native"
      }
    ]
  }
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |
| 401 | `{ "error": "Unauthorized: missing or invalid token" }` |
| 401 | `{ "error": "Unauthorized: invalid or expired token" }` |
| 403 | `{ "error": "Forbidden: you may only access your own account data" }` |
| 404 | `{ "error": "Account not found. It may not be funded yet. Use Friendbot on testnet." }` |

---

### `GET /api/accounts/:publicKey/balance`

Fetch native XLM balance only. Same auth and rate-limit rules as `GET /api/accounts/:publicKey`. Subject to **sensitive** rate limit.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "xlm": "9999.9999900"
  }
}
```

**Errors** — Same as `GET /api/accounts/:publicKey`.

---

## Payments

### `GET /api/payments/:publicKey`

Payment history from Horizon. Subject to **payment** rate limit.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key |

**Query parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| limit | integer | 20 | Max results (capped at 100) |
| cursor | string | — | Horizon pagination cursor |

**Response `200`**
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
      "memo": "Coffee",
      "createdAt": "2025-01-01T12:00:00.000Z",
      "transactionHash": "abc123...",
      "pagingToken": "..."
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |

---

### `GET /api/payments/:publicKey/stats`

Aggregate payment statistics (computed from up to 100 recent payments).

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "totalSentXLM": "150.0000000",
    "totalReceivedXLM": "75.0000000",
    "sentCount": 12,
    "receivedCount": 5,
    "totalTransactions": 17
  }
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |

---

## Analytics

All analytics routes use a 5-minute in-memory cache per public key. Subject to **read-only** rate limit.

### `GET /api/analytics/:publicKey/summary`

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "totalSentXLM": "150.0000000",
    "totalReceivedXLM": "75.0000000",
    "uniqueCounterparties": 8,
    "averageTransactionSize": "15.0000000",
    "totalTransactions": 17
  }
}
```

---

### `GET /api/analytics/:publicKey/top-recipients`

Top 5 recipients by total XLM sent.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "topRecipients": [
      {
        "address": "GXYZ...RECIPIENT",
        "totalXLMSent": "50.0000000"
      }
    ],
    "count": 1
  }
}
```

---

### `GET /api/analytics/:publicKey/activity`

Payment counts grouped by day of week (UTC).

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "activityByDay": [
      { "day": "Sunday", "dayIndex": 0, "transactionCount": 2 },
      { "day": "Monday", "dayIndex": 1, "transactionCount": 5 }
    ]
  }
}
```

### `GET /api/analytics/:publicKey/cohorts`

Retention-style cohort breakdown showing one-time vs repeat counterparties over time.

**Query parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| period | string | `month` | Cohort bucket size. Use `week` for weekly buckets. |
| periods | integer | `6` | Number of buckets to return, capped at 12. |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "period": "month",
    "periods": 6,
    "range": {
      "start": "2026-02-01T00:00:00.000Z",
      "end": "2026-07-31T23:59:59.999Z"
    },
    "cohorts": [
      {
        "periodStart": "2026-07-01T00:00:00.000Z",
        "periodEnd": "2026-07-31T23:59:59.999Z",
        "label": "Jul 2026",
        "period": "month",
        "sent": {
          "paymentCount": 4,
          "totalXLM": "42.0000000",
          "counterparties": {
            "oneTimeCounterparties": 2,
            "repeatCounterparties": 1,
            "totalCounterparties": 3
          }
        },
        "received": {
          "paymentCount": 3,
          "totalXLM": "18.0000000",
          "counterparties": {
            "oneTimeCounterparties": 1,
            "repeatCounterparties": 1,
            "totalCounterparties": 2
          }
        },
        "totalCounterparties": 5,
        "repeatRate": 40
      }
    ]
  }
}
```

### `GET /api/analytics/:publicKey/stream`

Server-sent events feed for new payment operations. The dashboard uses this
stream first and falls back to polling if the connection drops.

**Response `200`** `Content-Type: text/event-stream`

Each event payload is a normalized payment record:
```json
{
  "id": "operation-id",
  "type": "received",
  "amount": "10.0000000",
  "asset": "XLM",
  "from": "GABC...SENDER",
  "to": "GXYZ...RECIPIENT",
  "createdAt": "2025-01-01T12:00:00.000Z",
  "transactionHash": "abc123...",
  "pagingToken": "..."
}
```

**Errors (all analytics routes)**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |

---

## Tips

In-memory tip ledger (v1). Subject to **read-only** rate limit.

### `POST /api/tips`

Record a tip after an on-chain payment.

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| senderPublicKey | string | yes | Sender `G...` key |
| creatorPublicKey | string | yes | Creator `G...` key |
| amount | string | yes | Positive numeric amount |
| asset | string | no | Asset code (default `"XLM"`) |
| memo | string | no | Optional message |
| txHash | string | no | Stellar transaction hash |

**Example request**
```json
{
  "senderPublicKey": "GABC1234567890123456789012345678901234567890123456789012345",
  "creatorPublicKey": "GXYZ1234567890123456789012345678901234567890123456789012345",
  "amount": "5.0",
  "asset": "XLM",
  "memo": "Great stream!",
  "txHash": "a1b2c3..."
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "senderPublicKey": "GABC...",
    "creatorPublicKey": "GXYZ...",
    "amount": "5.0",
    "asset": "XLM",
    "memo": "Great stream!",
    "txHash": "a1b2c3...",
    "timestamp": "2025-01-01T12:00:00.000Z"
  },
  "message": "Tip recorded successfully"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "senderPublicKey is required, creatorPublicKey is required, ..." }` (combined validation messages) |
| 400 | `{ "error": "Invalid sender public key format" }` |
| 400 | `{ "error": "amount must be a positive number" }` |

---

### `GET /api/tips/received/:creatorPublicKey`

Tips received by a creator, with embedded stats.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| creatorPublicKey | string | Creator `G...` key |

**Query parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| limit | integer | 50 | Page size |
| offset | integer | 0 | Skip count |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "tips": [
      {
        "id": 1,
        "senderPublicKey": "GABC...",
        "creatorPublicKey": "GXYZ...",
        "amount": "5.0",
        "asset": "XLM",
        "memo": "",
        "txHash": "",
        "timestamp": "2025-01-01T12:00:00.000Z"
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0,
    "stats": {
      "totalTips": 1,
      "totalByAsset": {
        "XLM": { "count": 1, "amount": "5" }
      },
      "averageTip": "5",
      "largestTip": "5",
      "smallestTip": "5"
    }
  }
}
```

---

### `GET /api/tips/stats/:creatorPublicKey`

Tip statistics for a creator.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "totalTips": 10,
    "totalByAsset": {
      "XLM": { "count": 10, "amount": "50" }
    },
    "averageTip": "5",
    "largestTip": "20",
    "smallestTip": "1"
  }
}
```

---

### `GET /api/tips/sent/:senderPublicKey`

Tips sent by a user.

**Query parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| limit | integer | 50 | Page size |
| offset | integer | 0 | Skip count |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "tips": [],
    "total": 0,
    "limit": 50,
    "offset": 0
  }
}
```

---

## Turrets (txFunctions)

Automated transaction functions (DCA, stop-loss, escrow release). Subject to **payment** rate limit (10 req/min).

Supported `type` values: `dca`, `stop_loss`, `escrow_release`.

### `GET /api/turrets`

List deployments.

**Query parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| ownerPublicKey | string | no | Filter by owner `G...` key |

**Example request**
```
GET /api/turrets?ownerPublicKey=GABC1234567890123456789012345678901234567890123456789012345
```

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ownerPublicKey": "GABC...",
      "type": "dca",
      "status": "active",
      "config": { "intervalMinutes": 60, "amountQuote": 10, "quoteAssetCode": "USDC", "quoteAssetIssuer": null },
      "deploymentHash": "abc123...",
      "createdAt": "2025-01-01T12:00:00.000Z",
      "nextRunAt": "2025-01-01T13:00:00.000Z",
      "lastExecutedAt": null,
      "lastCheckedAt": null,
      "lastObservedPriceUsd": null,
      "lastError": null
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |

---

### `POST /api/turrets/challenge`

Create a signing challenge (ManageData transaction XDR).

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ownerPublicKey | string | yes | Owner `G...` key |
| type | string | yes | `dca`, `stop_loss`, or `escrow_release` |
| config | object | yes | Type-specific configuration |

**Example request (DCA)**
```json
{
  "ownerPublicKey": "GABC1234567890123456789012345678901234567890123456789012345",
  "type": "dca",
  "config": {
    "intervalMinutes": 60,
    "amountQuote": 10,
    "quoteAssetCode": "USDC",
    "quoteAssetIssuer": "GBBD47IF6LOC7NNYVK5WQCCFNNBX2L5TBRW2NTRU3OBMKENZ5YKF3NPS"
  }
}
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "challengeXDR": "AAAAAgAAAAC...",
    "deploymentHash": "a1b2c3d4e5f6...",
    "normalizedConfig": {
      "intervalMinutes": 60,
      "amountQuote": 10,
      "quoteAssetCode": "USDC",
      "quoteAssetIssuer": "GBBD47IF6LOC7NNYVK5WQCCFNNBX2L5TBRW2NTRU3OBMKENZ5YKF3NPS"
    },
    "networkPassphrase": "Test SDF Network ; September 2015"
  }
}
```

**Errors**

| Status | Body (examples) |
|--------|-------------------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |
| 400 | `{ "error": "Unsupported txFunction type. Use 'dca', 'stop_loss', or 'escrow_release'." }` |
| 400 | `{ "error": "DCA intervalMinutes must be at least 1" }` |

---

### `POST /api/turrets/deploy`

Deploy a txFunction after signing the challenge.

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ownerPublicKey | string | yes | Owner `G...` key |
| type | string | yes | `dca`, `stop_loss`, or `escrow_release` |
| config | object | yes | Same config used for challenge |
| deploymentHash | string | yes | Hash from challenge response |
| signedChallengeXDR | string | yes | Challenge XDR signed by owner |

**Example request**
```json
{
  "ownerPublicKey": "GABC1234567890123456789012345678901234567890123456789012345",
  "type": "dca",
  "config": {
    "intervalMinutes": 60,
    "amountQuote": 10,
    "quoteAssetCode": "USDC",
    "quoteAssetIssuer": "GBBD47IF6LOC7NNYVK5WQCCFNNBX2L5TBRW2NTRU3OBMKENZ5YKF3NPS"
  },
  "deploymentHash": "a1b2c3d4e5f6...",
  "signedChallengeXDR": "AAAAAgAAAAC..."
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "ownerPublicKey": "GABC...",
    "type": "dca",
    "status": "active",
    "config": { },
    "deploymentHash": "a1b2c3...",
    "createdAt": "2025-01-01T12:00:00.000Z",
    "nextRunAt": "2025-01-01T13:00:00.000Z"
  }
}
```

**Errors**

| Status | Body (examples) |
|--------|-------------------|
| 400 | `{ "error": "Configuration hash mismatch. Recreate challenge and sign again." }` |
| 400 | `{ "error": "Asset issuer is required for non-native asset USDC" }` |
| 401 | `{ "error": "Signed challenge was not signed by the owner account" }` |

---

### `GET /api/turrets/:id`

Get a single deployment.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| id | string (UUID) | Deployment ID |

**Example request**
```
GET /api/turrets/550e8400-e29b-41d4-a716-446655440000
```

**Response `200`** — `{ "success": true, "data": { ...deployment } }`

**Errors**

| Status | Body |
|--------|------|
| 404 | `{ "error": "txFunction not found" }` |

---

### `GET /api/turrets/:id/history`

Execution log for a deployment (newest first).

**Example request**
```
GET /api/turrets/550e8400-e29b-41d4-a716-446655440000/history
```

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "deploymentId": "550e8400-e29b-41d4-a716-446655440000",
      "status": "executed",
      "message": "DCA txFunction generated",
      "result": { "action": "buy_xlm_dca" },
      "createdAt": "2025-01-01T12:30:00.000Z"
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| 404 | `{ "error": "txFunction not found" }` |

---

### `POST /api/turrets/:id/pause`

Pause a deployment.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| id | string (UUID) | Deployment ID |

**Example request**
```
POST /api/turrets/550e8400-e29b-41d4-a716-446655440000/pause
```

**Response `200`** — `{ "success": true, "data": { ...deployment, "status": "paused" } }`

**Errors**

| Status | Body |
|--------|------|
| 404 | `{ "error": "txFunction not found" }` |

---

### `POST /api/turrets/:id/resume`

Resume a paused deployment.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| id | string (UUID) | Deployment ID |

**Example request**
```
POST /api/turrets/550e8400-e29b-41d4-a716-446655440000/resume
```

**Response `200`** — `{ "success": true, "data": { ...deployment, "status": "active" } }`

**Errors**

| Status | Body |
|--------|------|
| 404 | `{ "error": "txFunction not found" }` |

---

## Webhooks

Register Horizon SSE listeners that POST to your URL when payments are received.

### `POST /api/webhooks`

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| publicKey | string | yes | Account to monitor |
| url | string | yes | HTTPS endpoint to receive events |
| secret | string | yes | HMAC secret for `X-Webhook-Signature` |

**Example request**
```json
{
  "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
  "url": "https://example.com/webhooks/stellar",
  "secret": "whsec_..."
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": "1",
    "publicKey": "GABC...",
    "url": "https://example.com/webhooks/stellar",
    "secret": "whsec_...",
    "createdAt": "2025-01-01T12:00:00.000Z"
  }
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "publicKey, url, and secret are required" }` |
| 500 | `{ "error": "<message>" }` |

**Outbound webhook payload** (POST to your `url`)
```json
{
  "eventId": "12345",
  "attempt": 1,
  "createdAt": "2026-08-27T10:00:00Z",
  "network": "testnet",
  "event": "payment_received",
  "publicKey": "GABC...",
  "amount": "10.0000000",
  "asset": "XLM",
  "from": "G...",
  "transactionHash": "...",
  "ledger": 123456,
  "timestamp": "2026-08-27T10:00:00Z"
}
```

**Consumer Idempotency**:
Consumers should use the `eventId` to deduplicate webhook events and safely handle retries (should they occur). The `eventId` is globally unique for each stellar event and network, preventing duplicate processing if the webhook is delivered multiple times for the same occurrence.


Header: `X-Webhook-Signature` — HMAC-SHA256 hex of the JSON body using `secret`.

---

### `GET /api/webhooks/:publicKey`

List webhooks for an account.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key |

**Example request**
```
GET /api/webhooks/GABC1234567890123456789012345678901234567890123456789012345
```

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "publicKey": "GABC...",
      "url": "https://example.com/webhooks/stellar",
      "secret": "whsec_...",
      "createdAt": "2025-01-01T12:00:00.000Z"
    }
  ]
}
```

---

### `DELETE /api/webhooks/:id`

Delete a webhook by numeric ID.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| id | string | Webhook ID assigned at registration |

**Example request**
```
DELETE /api/webhooks/1
```

**Response `200`**
```json
{
  "success": true
}
```

**Errors**

| Status | Body |
|--------|------|
| 404 | `{ "error": "Webhook not found" }` |

---

## Global errors

These apply across routes unless noted otherwise.

| HTTP status | When | Example body |
|-------------|------|--------------|
| 400 | Invalid JSON body | `{ "error": "Invalid JSON body" }` |
| 404 | Unknown route | `{ "error": "Route not found" }` |
| 429 | Rate limit (global) | `{ "error": "Too many requests, please try again later." }` |
| 429 | Rate limit (sensitive) | `{ "error": "Too many requests to this endpoint, please wait 1 minute." }` |
| 429 | Rate limit (read-only) | `{ "error": "Too many requests to sensitive routes, please wait 1 minute." }` |
| 429 | Rate limit (payment) | `{ "error": "Too many requests to payment/turret routes, please wait 1 minute." }` |
| 500 | Unhandled server error | `{ "error": "Internal Server Error" }` or `{ "error": "<message>" }` |

**CORS:** Requests from origins not listed in `ALLOWED_ORIGINS` are rejected by the CORS middleware.

---

## Turrets sidecar (optional)

When `TURRETS_PORT` is set (default `4100`), a separate process exposes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `http://localhost:4100/health` | Sidecar health |
| * | `http://localhost:4100/tx-functions/*` | Same txFunction routes as `/api/turrets/*` on the main server |

The main API on port **4000** mounts turrets at `/api/turrets`; prefer that URL for application integration.

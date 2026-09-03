# API Documentation — Stellar MicroPay

Base URL: `http://localhost:4000`

All responses follow the format:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "message" }
```

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

All endpoints are rate limited to **100 requests per 15 minutes** per IP address.

When exceeded, the API returns:
```json
{ "error": "Too many requests, please try again later." }
```

---

## Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad request (invalid input) |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 501 | Feature not yet implemented |

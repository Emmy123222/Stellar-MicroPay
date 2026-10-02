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

## Authentication

Stellar MicroPay implements **SEP-0010 (Stellar Web Authentication)**, a challenge-response authentication protocol that allows clients to prove ownership of a Stellar account (keypair) cryptographically without exposing secret keys.

Once the challenge transaction is verified, the server issues a JSON Web Token (JWT) that can be passed in subsequent API calls via an `Authorization: Bearer <token>` header or used via the HTTP-only `jwt` cookie.

### Endpoints Overview

- **`GET /api/auth?account=:publicKey`**: Issues a challenge transaction XDR signed by the server.
- **`POST /api/auth`**: Verifies the challenge transaction signed by the client wallet and returns a JWT token.

> **Note on Route Terminology:** In architectural descriptions, these endpoints are often referred to as `/api/auth/challenge` (Step 1) and `/api/auth/verify` (Step 4). In the current API implementation, both steps are served at `/api/auth` using `GET` and `POST` methods respectively, and the client public key is supplied via the `account` query parameter.

---

### Authentication Flow (Sequence Diagram)

```text
 +--------+                   +--------+                   +--------+
 | Client |                   | Wallet |                   | Server |
 +--------+                   +--------+                   +--------+
     |                            |                            |
     | 1. GET /api/auth?account=G...                           |
     |-------------------------------------------------------->|
     |                            |                            |
     |                            |             Build challenge tx
     |                            |             (time-bounds: 300s,
     |                            |              nonce, home domain)
     |                            |             Sign with server key
     |                            |                            |
     | 2. 200 OK: { transaction: <challenge_xdr>, ... }       |
     |<--------------------------------------------------------|
     |                            |                            |
     | 3. Request signature       |                            |
     |--------------------------->|                            |
     |                            | User approves & signs tx   |
     |                            | with client private key    |
     |    Return signed XDR       |                            |
     |<---------------------------|                            |
     |                            |                            |
     | 4. POST /api/auth { transaction: <signed_xdr> }         |
     |-------------------------------------------------------->|
     |                            |                            |
     |                            |             Verify:
     |                            |             - Server signature
     |                            |             - Client signature
     |                            |             - Time window (5 min)
     |                            |             - Nonce & home domain
     |                            |             Generate JWT token
     |                            |                            |
     | 5. 200 OK: { success: true, token: <jwt> }              |
     |<--------------------------------------------------------|
     |    (Sets HttpOnly cookie 'jwt')                         |
     |                            |                            |
     | 6. Authenticated Requests:                              |
     |    GET /api/... with Authorization: Bearer <jwt>        |
     |-------------------------------------------------------->|
     |                            |                            |
```

---

### Step-by-Step Guide

#### Step 1: Request Challenge Transaction

The client requests a SEP-0010 challenge transaction for their Stellar account public key.

**Endpoint:** `GET /api/auth`

**Parameters:**
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `account` | query | string | Yes | Client's Stellar public key (`G...`, 56 characters) |

**Example Request:**
```bash
curl -s -X GET "http://localhost:4000/api/auth?account=GBZXN7PIRZGNMHGA728RGRFZAPPWN9G8K10BO5CSM9P0QO9N24M4TXY"
```

**Example Response (200 OK):**
```json
{
  "transaction": "AAAAAgAAAAD8n5L8XgX7hZ0w...",
  "networkPassphrase": "Test SDF Network ; September 2015"
}
```

- `transaction`: Base64-encoded challenge transaction envelope XDR.
- `networkPassphrase`: The Stellar network passphrase for signature validation.

---

#### Step 2: Server Builds and Signs Challenge (Server Internals)

Upon receiving the request, the server:
1. Validates the client public key format.
2. Constructs a SEP-0010 challenge transaction with:
   - Source account: Server's Stellar account.
   - Sequence number: `0`.
   - Time bounds: Valid for 300 seconds (5 minutes) from generation.
   - Operation: A `ManageData` operation where the key is `<HomeDomain> auth` and value is a random 48-byte cryptographic nonce.
3. Signs the transaction envelope using the server's private key.
4. Returns the serialized XDR string to the client.

---

#### Step 3: Client Signs Transaction with Wallet

The client signs the transaction XDR with the user's private key. Because private keys are managed securely by wallet applications or hardware keys, cryptographic signing is performed client-side rather than with `curl`.

##### Browser Client (Freighter Wallet)
```typescript
import { signTransaction } from "@stellar/freighter-api";

// Sign the challenge XDR received from GET /api/auth
const signedXDR = await signTransaction(challengeXDR, {
  networkPassphrase: "Test SDF Network ; September 2015",
});
```

##### Programmatic Client (Node.js SDK)
```javascript
const { TransactionBuilder, Keypair } = require("@stellar/stellar-sdk");

const clientKeypair = Keypair.fromSecret("SCZANGBA5YHTG45ABC...");
const tx = TransactionBuilder.fromXDR(challengeXDR, networkPassphrase);
tx.sign(clientKeypair);
const signedXDR = tx.toXDR();
```

---

#### Step 4: Submit Signed Challenge for Verification

The client sends the signed challenge transaction back to the server.

**Endpoint:** `POST /api/auth`

**Headers:**
- `Content-Type: application/json`

**Body:**
```json
{
  "transaction": "AAAAAgAAAAD8n5L8XgX7hZ0w...SIGNED_ENVELOPE_XDR..."
}
```

**Example Request:**
```bash
curl -s -X POST "http://localhost:4000/api/auth" \
  -H "Content-Type: application/json" \
  -d '{
    "transaction": "AAAAAgAAAAD8n5L8XgX7hZ0w...SIGNED_ENVELOPE_XDR..."
  }'
```

---

#### Step 5: Server Verifies and Issues JWT

The server verifies the submitted challenge:
1. Validates the server's own signature is intact.
2. Validates that the transaction was signed by the client account key (`account`).
3. Confirms the transaction time bounds are still valid (within 300 seconds).
4. Verifies the home domain and network passphrase.

Once verified, the server issues a JWT signed with `JWT_SECRET`:
- **Token Claims:** `{ "publicKey": "GBZXN7PIRZGNMHGA728RGRFZAPPWN9G8K10BO5CSM9P0QO9N24M4TXY" }`
- **Validity:** 24 hours (`expiresIn: "24h"`)

**Example Response (200 OK):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwdWJsaWNLZXkiOiJHQlpYTjdQSVJaR05NSEdBNzI4UkdSRlpBUFBXTjlHOEsxMEJPNUNTTTlQMFFPOU4yNE00VFhZIiwiaWF0IjoxNzI3NDEwODAwLCJleHAiOjE3Mjc0OTcyMDB9.EXAMPLE_SIGNATURE"
}
```

The server also sets an HTTP-only session cookie:
```http
Set-Cookie: jwt=<token>; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400
```

---

#### Step 6: Authenticated Requests

Pass the JWT in subsequent requests using the standard `Authorization` header:

```bash
curl -s -X GET "http://localhost:4000/api/payments/GBZXN7PIRZGNMHGA728RGRFZAPPWN9G8K10BO5CSM9P0QO9N24M4TXY" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwdWJsaWNLZXkiOiJHQlpYTjdQSVJaR05NSEdBNzI4UkdSRlpBUFBXTjlHOEsxMEJPNUNTTTlQMFFPOU4yNE00VFhZIiwiaWF0IjoxNzI3NDEwODAwLCJleHAiOjE3Mjc0OTcyMDB9.EXAMPLE_SIGNATURE"
```

---

### Error Responses

| Status | Error Response | Cause |
|--------|----------------|-------|
| 400 | `{"error": "Missing account query parameter"}` | `GET /api/auth` called without `?account=` query parameter |
| 400 | `{"error": "Missing transaction in request body"}` | `POST /api/auth` payload missing `transaction` property |
| 400 | `{"error": "<error message>"}` | Invalid public key format or unparseable transaction XDR |
| 401 | `{"error": "Unauthorized: <reason>"}` | Challenge expired (> 300s window), invalid signature, or wrong signer account |
| 401 | `{"error": "Unauthorized: missing or invalid token"}` | Protected route called without `Bearer <token>` |
| 401 | `{"error": "Unauthorized: invalid or expired token"}` | JWT expired or token signature failed verification |

---

### Security Considerations

- **Replay Protection:** Challenge transactions have a strict 300-second (5 minute) validity window and contain unique random nonces. Expired or duplicate transactions are rejected.
- **Key Isolation:** Private keys never leave the user's wallet or client environment.
- **Token Storage:** Store JWTs securely. In browser applications, use the HTTP-only cookie or memory storage; avoid storing JWTs in unencrypted persistent storage (such as `localStorage`).
- **Network Isolation:** Challenge transactions explicitly include the network passphrase (`Test SDF Network ; September 2015` for testnet or `Public Global Stellar Network ; September 2015` for mainnet) preventing signature reuse across networks.

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

### `POST /api/payments/submit`

Submit a signed payment transaction to Horizon. Safe to retry: send a
client-generated UUID in the `X-Idempotency-Key` header and repeated requests
within 24 hours replay the original response instead of submitting twice.

**Headers**
| Name | Required | Description |
|------|----------|-------------|
| `X-Idempotency-Key` | No | UUID (e.g. `crypto.randomUUID()`). Replays the cached response on retry. |

**Body**
```json
{ "signedXDR": "AAAA...signed transaction envelope" }
```

**Response (200)**
```json
{
  "success": true,
  "data": {
    "hash": "abc123...",
    "ledger": 42,
    "successful": true
  }
}
```

When a key is reused within 24 hours the cached response is returned with the
`X-Idempotency-Replayed: true` header and no second submission occurs.

**Errors**
| Status | Meaning |
|--------|---------|
| 400 | Missing `signedXDR`, invalid XDR, or malformed idempotency key |

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

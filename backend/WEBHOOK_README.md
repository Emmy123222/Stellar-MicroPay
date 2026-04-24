# Stellar Webhook Notification System

This system monitors Stellar payments and delivers webhook notifications when payments are received to registered public keys.

## Features

- **Real-time monitoring**: Uses Stellar Horizon SSE streams to monitor payments in real-time
- **Webhook management**: Register, list, and delete webhooks via REST API
- **Secure delivery**: Webhooks are signed with HMAC-SHA256 for verification
- **Automatic cleanup**: SSE streams are automatically managed based on webhook registrations

## API Endpoints

### Register Webhook
```http
POST /api/webhooks
Content-Type: application/json

{
  "publicKey": "GCKFBEIYTKP6JY4Q2UZKBQJLGR2HKFOQNPZGFR5HKXQXQXQXQXQXQXQX",
  "url": "https://your-app.com/webhook",
  "secret": "your-webhook-secret"
}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "publicKey": "GCKFBEIYTKP6JY4Q2UZKBQJLGR2HKFOQNPZGFR5HKXQXQXQXQXQXQXQX",
  "url": "https://your-app.com/webhook",
  "createdAt": "2024-01-01T12:00:00.000Z"
}
```

### List Webhooks
```http
GET /api/webhooks/{publicKey}
```

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "publicKey": "GCKFBEIYTKP6JY4Q2UZKBQJLGR2HKFOQNPZGFR5HKXQXQXQXQXQXQXQX",
    "url": "https://your-app.com/webhook",
    "createdAt": "2024-01-01T12:00:00.000Z"
  }
]
```

### Delete Webhook
```http
DELETE /api/webhooks/{webhookId}
```

**Response:** `204 No Content` on success, `404 Not Found` if webhook doesn't exist.

## Webhook Payload

When a payment is received, your webhook endpoint will receive:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "payment",
  "publicKey": "GCKFBEIYTKP6JY4Q2UZKBQJLGR2HKFOQNPZGFR5HKXQXQXQXQXQXQXQX",
  "amount": "100.0000000",
  "asset": "XLM",
  "from": "GDSAMPLE...",
  "to": "GCKFBEIY...",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Webhook Security

Each webhook includes an `X-Webhook-Signature` header with HMAC-SHA256 signature:

```
X-Webhook-Signature: sha256=a8b7c6d5e4f3g2h1...
```

### Verifying Signatures

```javascript
const crypto = require("crypto");

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
    
  return signature === `sha256=${expectedSignature}`;
}

// In your webhook handler
app.post("/webhook", (req, res) => {
  const signature = req.headers["x-webhook-signature"];
  const payload = req.body;
  
  if (!verifyWebhookSignature(payload, signature, "your-secret")) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  
  // Process the payment notification
  console.log("Payment received:", payload);
  res.status(200).json({ received: true });
});
```

## Monitoring Behavior

- **Automatic start**: SSE monitoring starts when the first webhook is registered for a public key
- **Automatic stop**: SSE monitoring stops when all webhooks for a public key are deleted
- **Reconnection**: Automatic reconnection on SSE connection errors with 5-second delay
- **Testnet only**: Currently configured for Stellar testnet (horizon-testnet.stellar.org)

## Error Handling

- **Delivery failures**: Logged to console with webhook ID, URL, and status code
- **No retries**: Failed webhook deliveries are not retried
- **Timeout**: 10-second timeout for webhook delivery requests

## Installation

1. Install the required dependency:
```bash
npm install eventsource
```

2. The webhook system is automatically initialized when the server starts.

## Example Usage

See `examples/webhook-example.js` for a complete example of registering and managing webhooks.

## Testing

Run the webhook tests:
```bash
npm test -- __tests__/webhooks.test.js
```
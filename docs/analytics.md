# Analytics Endpoints — Testing & Implementation Guide

## Overview

Three analytics endpoints are available for transaction volume insights:

✅ **GET /api/analytics/:publicKey/summary** — Transaction overview`n✅ **GET /api/analytics/:publicKey/top-recipients** — Top 5 recipients by volume`n✅ **GET /api/analytics/:publicKey/activity** — Transaction counts by day of week`n
An admin endpoint is also available:

✅ **DELETE /api/analytics/cache/:publicKey** — Force-invalidate cached analytics for an account (JWT + admin only)

All standard endpoints include:
- **Caching**: 5-minute TTL using an in-memory Map with LRU eviction (max 500 entries by default)
- **Error Handling**: Graceful handling of Horizon errors and invalid public keys
- **Rate Limiting**: Protected by `strictLimiter` middleware
- **Input Sanitization**: Public key validation via `validatePublicKey`

## Files Added/Modified

### New/Updated Files
- `backend/src/services/analyticsService.js` — Business logic, TTL cache, LRU bounding
- `backend/src/controllers/analyticsController.js` — Request handlers
- `backend/src/routes/analytics.js` — Route definitions and admin auth
- `backend/__tests__/analytics.test.js` — Comprehensive unit + integration tests
- `backend/src/server.js` — CORS includes DELETE for endpoint access
- `backend/src/swagger.js` — OpenAPI docs and bearer auth scheme
- `docs/analytics.md` — Usage documentation

## Caching Behavior

All endpoints use **5-minute TTL in-memory caching** to minimize Horizon API calls:

- **First request** → Fetches from Horizon, stores in cache
- **Subsequent requests** (within 5 min) → Returns cached data instantly
- **After 5 minutes** → Cache expires, fetches fresh data from Horizon
- **When cache exceeds max size** → Least-recently-used entries are evicted first
- **Admin invalidation** → `DELETE /api/analytics/cache/:publicKey` clears cached entries immediately

The cache is bounded with **LRU eviction**:

- **Max size**: 500 entries by default, configurable via `ANALYTICS_CACHE_MAX_SIZE`
- Every cache hit refreshes recency, so hot accounts stay cached while inactive ones are evicted
- Memory usage remains bounded for the lifetime of the process

### Admin Cache Invalidation

**Route**: `DELETE /api/analytics/cache/:publicKey`

Force-invalidates all cached analytics entries for an account so the next request fetches fresh data from Horizon. This is useful after an account receives new transactions that must be reflected immediately.

**Authentication**: Requires a valid SEP-0010 JWT (`Bearer` token from `POST /api/auth`). The JWT's `publicKey` must be listed in the `ADMIN_PUBLIC_KEYS` env var (comma-separated). If `ADMIN_PUBLIC_KEYS` is unset, all requests are rejected with `403`.

```bash
curl -X DELETE \
  -H "Authorization: Bearer $JWT" \
  http://localhost:4000/api/analytics/cache/YOUR_PUBLIC_KEY
```

**Response**:
```json
{
  "success": true,
  "data": {
    "publicKey": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW",
    "invalidated": 3
  }
}
```

This provides:
- ✅ Reduced API load on Stellar Horizon
- ✅ Faster response times for repeated queries
- ✅ No external database required (simple in-memory Map)
- ✅ Bounded memory via LRU eviction
- ✅ On-demand fresh data via the admin invalidation endpoint

## Testing Guide

### Unit / Integration Tests

```bash
cd backend
npm test -- __tests__/analytics.test.js
```

Coverage includes:
- ✅ Summary statistics computation
- ✅ Empty payment history handling
- ✅ Cache functionality (5-minute TTL)
- ✅ Top recipients sorting
- ✅ Sent payments only filtering
- ✅ Top 5 limitation
- ✅ Activity by day for all 7 days
- ✅ Cache invalidation count
- ✅ LRU eviction beyond max size
- ✅ Admin invalidation endpoint auth and behavior

## Implementation Notes

- `backend/src/services/analyticsService.js` is the canonical cache owner.
- `backend/src/routes/analytics.js` enforces admin access before invalidation.
- `backend/src/server.js` allows the `DELETE` verb in CORS.
- `backend/src/swagger.js` documents the admin endpoint and `bearerAuth` security scheme.`n
# Durable Storage and Queue Boundaries

## Overview

Stellar MicroPay uses a **hybrid persistence model**: the backend relies on in-memory storage for operational state, while the Stellar blockchain and Soroban smart contracts serve as the authoritative, durable data layer for financial data. This document defines the storage boundaries, queue processing patterns, and failure modes.

## Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Backend (Node.js)                                  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        In-Memory State                               │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
│  │  │ webhookStore │  │  tipsService │  │    turretsService        │  │    │
│  │  │   (Map)      │  │    (Map)     │  │  (Map + Arrays)          │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
│  │  │  usernameSvc │  │  analytics   │  │  scheduledTransactionSvc │  │    │
│  │  │   (Map)      │  │  (5min cache)│  │      (Map)               │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Queue Processing                                │    │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │    │
│  │  │  Turrets Runner  │  │  Webhook Delivery│  │  Payment Monitor│  │    │
│  │  │  (setInterval)   │  │ (Promise.allSettled)│  │  (SSE Stream)  │  │    │
│  │  └──────────────────┘  └──────────────────┘  └─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ Horizon REST / Soroban RPC
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Stellar Network                                      │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Durable On-Chain State                            │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
│  │  │   Streams    │  │   Escrows    │  │    Receipts              │  │    │
│  │  │ (Soroban)    │  │  (Soroban)   │  │   (Soroban)              │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## In-Memory Storage Boundaries

### Characteristics

| Property | Behavior |
|----------|----------|
| **Lifetime** | Process-scoped — data exists only while the Node.js process runs |
| **Persistence** | None — all data is lost on restart, crash, or redeployment |
| **Replication** | None — each instance has its own isolated state |
| **Capacity** | Bounded by container memory limits |
| **Consistency** | Single-process, single-threaded — no concurrency concerns |

### Storage Modules

#### 1. Webhook Store (`webhookStore.js`)

| Aspect | Detail |
|--------|--------|
| **Data** | Webhook registrations (id, publicKey, url, secret, createdAt) |
| **Access Pattern** | Key-value by ID; filtered by publicKey |
| **Size Bound** | Unbounded — grows with each registration |
| **Failure Impact** | Webhooks lost on restart; SSE monitors must be re-established |
| **Recovery** | `resumeAllMonitors()` on startup (re-registers existing webhooks) |

#### 2. Tips Service (`tipsService.js`)

| Aspect | Detail |
|--------|--------|
| **Data** | Tip records (id, from, to, amount, memo, transactionHash, createdAt) |
| **Access Pattern** | Key-value by ID; filtered by creator/sender publicKey |
| **Size Bound** | Unbounded — grows with each tip |
| **Failure Impact** | Tip history lost; on-chain receipts remain authoritative |
| **Recovery** | None — tips are reconstructed from on-chain data if needed |

#### 3. Turrets Service (`turretsService.js`)

| Aspect | Detail |
|--------|--------|
| **Data** | Deployments, execution history, audit log |
| **Access Pattern** | Key-value by deployment ID; filtered by owner |
| **Size Bound** | Execution history capped at 1000 entries; audit log at 5000 |
| **Failure Impact** | Active deployments stop evaluating; state lost |
| **Recovery** | Deployments must be re-created after restart |

#### 4. Username Service (`usernameService.js`)

| Aspect | Detail |
|--------|--------|
| **Data** | Username-to-publicKey mappings |
| **Access Pattern** | Key-value by username |
| **Size Bound** | Unbounded |
| **Failure Impact** | Username registry lost; users must re-register |
| **Recovery** | None — usernames are not stored on-chain |

#### 5. Analytics Cache

| Aspect | Detail |
|--------|--------|
| **Data** | Aggregated payment statistics per publicKey |
| **Access Pattern** | Key-value by publicKey with 5-minute TTL |
| **Size Bound** | Bounded by TTL — stale entries expire |
| **Failure Impact** | Cache miss on next request; data re-fetched from Horizon |
| **Recovery** | Automatic — cache repopulates on demand |

### Intentionally Ephemeral Design

The backend's in-memory storage is **by design**, not by omission:

1. **Stateless scaling**: Multiple backend instances can run independently without coordination
2. **No migration complexity**: No schema migrations, no ORM, no database versioning
3. **Blockchain as source of truth**: Financial data (payments, tips, streams) is anchored on-chain
4. **Reduced attack surface**: No database to secure, no connection strings to leak

## Queue Boundaries

### Processing Patterns

The backend uses **in-process, timer-based processing** rather than a distributed message queue. This is appropriate for the current scale but has defined boundaries.

#### 1. Turrets Evaluation Runner

```
┌─────────────────────────────────────────────────────────────┐
│                    Turrets Runner                            │
│                                                              │
│  setInterval (default 30s)                                   │
│       │                                                      │
│       ▼                                                      │
│  For each active deployment:                                 │
│    ├── Check nextRunAt ≤ now?                                │
│    ├── Fetch XLM/USD price (CoinGecko, 30s cache)           │
│    ├── Evaluate condition (DCA interval, stop-loss price)    │
│    ├── Generate execution log entry                          │
│    └── Update deployment state                               │
│                                                              │
│  Failure mode: Single evaluation failure catches exception,  │
│  logs error, continues to next deployment.                   │
└─────────────────────────────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| **Trigger** | `setInterval` with configurable interval (`TURRETS_EVALUATION_INTERVAL_MS`) |
| **Concurrency** | Sequential — one deployment evaluated at a time |
| **Error Handling** | Per-deployment try/catch; errors logged, don't block other deployments |
| **Backpressure** | None — if evaluation takes longer than interval, next tick waits |
| **Ordering** | Insertion order (Map iteration) |
| **Durability** | Execution history is in-memory only |

#### 2. Webhook Delivery

```
┌─────────────────────────────────────────────────────────────┐
│                   Webhook Delivery                           │
│                                                              │
│  Payment Event (SSE from Horizon)                            │
│       │                                                      │
│       ▼                                                      │
│  Find matching webhooks (by publicKey)                       │
│       │                                                      │
│       ▼                                                      │
│  Promise.allSettled(                                         │
│    webhooks.map(wh =>                                        │
│      POST(wh.url, payload, HMAC signature)                   │
│    )                                                         │
│  )                                                           │
│                                                              │
│  Failure mode: Individual delivery failures logged,          │
│  don't affect other webhooks. No retry queue.                │
└─────────────────────────────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| **Trigger** | SSE payment event from Horizon |
| **Concurrency** | Parallel via `Promise.allSettled` |
| **Error Handling** | Per-webhook; failures logged, no retry |
| **Backpressure** | None — unbounded parallel delivery |
| **Ordering** | No guaranteed ordering across webhooks |
| **Durability** | No delivery queue — if backend is down, events are missed |

#### 3. Payment Monitor (SSE Stream)

```
┌────────────────────────────────────────────────────────�────────────────────┐
│                   Payment Monitor                                    │
│                                                              │
│  Horizon SSE Stream (per monitored publicKey)                │
│       │                                                      │
│       ▼                                                      │
│  Event received → Forward to connected clients (SSE)         │
│       │                                                      │
│       ▼                                                      │
│  Trigger webhook delivery for matching registrations         │
│                                                              │
│  Failure mode: Stream disconnect → reconnect with backoff    │
└─────────────────────────────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| **Trigger** | Horizon Server-Sent Events |
| **Concurrency** | One stream per monitored publicKey |
| **Error Handling** | Automatic reconnection with exponential backoff |
| **Backpressure** | SSE handles flow control |
| **Ordering** | Horizon guarantees event ordering per stream |
| **Durability** | No replay — events during disconnect are missed |

### Queue Boundary Decisions

| Decision | Rationale |
|----------|-----------|
| **No Redis/RabbitMQ** | Current scale doesn't justify operational complexity |
| **No persistent queue** | Webhook delivery is best-effort; critical data is on-chain |
| **No dead letter queue** | Failed webhook deliveries are logged, not retried |
| **No priority queue** | All evaluations are equal priority |
| **No batch processing** | Real-time evaluation required for stop-loss triggers |

## Data Durability Matrix

| Data Type | Storage | Durability | Recovery | Authoritative Source |
|-----------|---------|------------|----------|---------------------|
| Payment history | Horizon API | Permanent | Automatic | Stellar blockchain |
| Tip receipts | Soroban contract | Permanent | Automatic | Soroban blockchain |
| Stream state | Soroban contract | Permanent | Automatic | Soroban blockchain |
| Escrow state | Soroban contract | Permanent | Automatic | Soroban blockchain |
| Webhook registrations | In-memory Map | Ephemeral | Manual re-registration | Backend (ephemeral) |
| Tip records | In-memory Map | Ephemeral | Reconstruct from chain | Soroban receipts |
| Username mappings | In-memory Map | Ephemeral | Manual re-registration | Backend (ephemeral) |
| Turrets deployments | In-memory Map | Ephemeral | Manual re-deployment | Backend (ephemeral) |
| Analytics cache | In-memory (TTL) | 5-minute TTL | Automatic repopulation | Horizon API |
| Execution history | In-memory (capped) | Ephemeral | None | Backend (ephemeral) |

## Failure Modes and Mitigation

### Process Restart

| Component | Impact | Mitigation |
|-----------|--------|------------|
| Webhook store | All registrations lost | Clients must re-register; `resumeAllMonitors()` is a no-op after restart |
| Turrets runner | Deployments lost, evaluation stops | Users must re-deploy txFunctions |
| SSE monitors | Streams disconnected | `resumeAllMonitors()` re-establishes from webhook store (if persisted) |
| Analytics cache | Cache cold | Automatic repopulation on first request |

### Network Partition

| Component | Impact | Mitigation |
|-----------|--------|------------|
| Horizon API unreachable | Payment history unavailable | Frontend can call Horizon directly |
| CoinGecko unreachable | Turrets evaluation fails | Price cached for 30s; stale price used temporarily |
| Webhook endpoint unreachable | Delivery fails | Logged; no retry (by design) |

### Memory Pressure

| Component | Bound | Behavior at Limit |
|-----------|-------|-------------------|
| Execution history | 1000 entries | Oldest entries evicted (FIFO) |
| Audit log | 5000 entries | Oldest entries evicted (FIFO) |
| Other stores | Unbounded | OOM kill by container runtime |

## Scaling Boundaries

### Current Limits

| Resource | Limit | Bottleneck |
|----------|-------|------------|
| Webhooks | ~10,000 (memory-bound) | Map iteration on each payment event |
| Turrets deployments | ~1,000 (CPU-bound) | Sequential evaluation in setInterval |
| Concurrent SSE streams | ~500 (file descriptors) | One stream per monitored publicKey |
| Analytics cache | ~10,000 entries (memory) | 5-minute TTL limits growth |

### When to Introduce Persistent Storage

| Signal | Action |
|--------|--------|
| Webhook registrations exceed 10,000 | Migrate to PostgreSQL or DynamoDB |
| Turrets deployments exceed 1,000 | Introduce Redis for state + worker pool |
| Webhook delivery requires retries | Add a persistent queue (SQS, RabbitMQ) |
| Multi-instance deployment needed | Shared state store (Redis, PostgreSQL) |
| Username registry must survive restarts | Persistent key-value store |

### When to Introduce a Message Queue

| Signal | Action |
|--------|--------|
| Webhook delivery latency exceeds 5s | Dedicated delivery workers with queue |
| Turrets evaluation exceeds interval | Priority queue + parallel workers |
| Need exactly-once delivery semantics | Idempotent consumer + deduplication |
| Cross-instance coordination required | Distributed queue (Kafka, NATS) |

## Security Boundaries

### Secret Handling

| Secret | Storage | Access |
|--------|---------|--------|
| JWT signing secret | Docker secret (`/run/secrets/jwt_secret`) | Read at startup, cached in memory |
| Server private key | Docker secret (`/run/secrets/server_private_key`) | Read at startup, cached in memory |
| Webhook HMAC secrets | In-memory Map | Never logged, never returned in API responses |
| Stellar user keys | Never stored | Held only in user's Freighter wallet |

### Data Isolation

| Boundary | Enforcement |
|----------|-------------|
| Account data access | JWT + `requireOwnAccount` middleware |
| Webhook secrets | Stripped from all API responses (`sanitizeWebhook`) |
| Stellar secret keys | Redacted from logs and error messages (`sanitizeMessage`) |
| Rate limiting | Per-IP, with stricter limits on sensitive routes |

## Operational Procedures

### Backup and Recovery

Since backend state is ephemeral, recovery procedures focus on **reconstruction** rather than **restoration**:

1. **After restart**: Re-register webhooks, re-deploy txFunctions, re-register usernames
2. **After data loss**: Reconstruct tip history from Soroban receipts
3. **After extended outage**: Replay Horizon payment operations to rebuild analytics

### Monitoring

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| Memory usage | > 512 MB | > 1 GB |
| Webhook store size | > 5,000 | > 10,000 |
| Turrets deployment count | > 500 | > 1,000 |
| SSE stream count | > 200 | > 500 |
| Webhook delivery failure rate | > 5% | > 20% |
| Turrets evaluation error rate | > 10% | > 30% |

## Future Evolution

### Phase 1: Persistent Webhook Store (Current Need)

- Migrate webhook registrations to PostgreSQL
- Enables webhook survival across restarts
- Enables multi-instance deployment

### Phase 2: Message Queue for Webhook Delivery

- Introduce SQS or RabbitMQ for reliable delivery
- Add retry with exponential backoff
- Add dead letter queue for failed deliveries

### Phase 3: Distributed Turrets Evaluation

- Move evaluation to worker pool
- Use Redis for deployment state
- Enable horizontal scaling of evaluation workers

### Phase 4: Event Sourcing

- Reconstruct backend state from Stellar events
- Full audit trail of all state changes
- Point-in-time recovery capability

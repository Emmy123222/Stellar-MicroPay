# Implementation Report: Four-Issue Fix for Stellar MicroPay

**Date:** 2026-08-27  
**Author:** Kilo  
**Scope:** Container validation, deployment smoke tests, OpenAPI drift detection, architecture documentation

---

## 1. Issue 1: Docker Compose Secrets and Network-Specific Environment Validation

### Problem
The Docker Compose files lacked explicit network isolation, had no secrets management, and provided no validation that environment-specific configuration (testnet vs. mainnet) was correct.

### What I Changed

**docker-compose.yml (Development)**
- Added two explicit networks: `frontend` (bridge) and `backend` (bridge, internal)
- Assigned `frontend` service to the `frontend` network
- Assigned `backend` service to both `frontend` and `backend` networks
- The `backend` network is marked `internal: true`, preventing direct external access to the backend service

**docker-compose.staging.yml**
- Added three explicit networks: `proxy`, `frontend`, `backend` (internal)
- Assigned `nginx` to `proxy`, `frontend` to `proxy` + `frontend`, `backend` to `frontend` + `backend`
- Added Docker secrets: `jwt_secret` and `server_private_key`, mounted from `./secrets/` directory
- Removed unnecessary `ports` exposure on frontend and backend (only nginx exposes port 80)
- Added `FEDERATION_DOMAIN` and `FEDERATION_DOMAINS` environment variables to backend

**docker-compose.prod.yml**
- Added three explicit networks: `proxy`, `frontend`, `backend` (internal)
- Added Docker secrets: `jwt_secret` and `server_private_key`
- Added port 443 for HTTPS termination
- Added production environment variables: `ALLOWED_ORIGINS`, `FEDERATION_DOMAIN`, `FEDERATION_DOMAINS`
- Set `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` and `NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org` on frontend

**scripts/validate-compose.js (New)**
I created a validation script that performs four checks per environment:
1. **Compose syntax validation** — runs `docker compose config --quiet` to verify YAML validity
2. **Secrets file validation** — checks that required secret files exist, are non-empty, and have restrictive file permissions
3. **Network isolation validation** — verifies that all required networks are defined and that internal isolation is configured
4. **Environment variable validation** — confirms that network-specific variables (testnet vs. mainnet) are correctly set

The script iterates over all three environments (development, staging, production) and reports errors with actionable messages.

**secrets/ directory (New)**
- Created with `.gitkeep` to preserve the directory structure
- Added to `.gitignore` to prevent accidental commits of secret files

**.gitignore (Updated)**
- Added `secrets/*.txt` to prevent secret files from being committed

### How to Use
```bash
# Validate all compose configurations
npm run validate:compose

# Create required secret files before deploying staging/production
echo "your-jwt-secret" > secrets/jwt_secret.txt
echo "your-server-private-key" > secrets/server_private_key.txt
chmod 600 secrets/*.txt
```

---

## 2. Issue 2: Staging Smoke Tests and Automatic Rollback Criteria

### Problem
The staging deployment workflow had no post-deployment validation. A broken deployment could reach users with no automated detection or rollback.

### What I Changed

**scripts/smoke-test.js (New)**
I created a comprehensive smoke test script that validates the staging environment after deployment. It performs eight checks:

1. **Health endpoint** — `GET /health` returns 200
2. **API health endpoint** — `GET /api/health` returns 200
3. **Frontend static files** — `GET /` returns 200
4. **Stellar TOML discovery** — `GET /.well-known/stellar.toml` returns valid TOML with `FEDERATION_SERVER`
5. **API documentation** — `GET /api/docs.json` returns valid OpenAPI spec
6. **Federation endpoint** — `GET /federation` returns 200 or 404 (valid response)
7. **Security headers** — Verifies `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` are present and `X-Powered-By` is absent
8. **Network isolation** — Confirms staging does not expose mainnet references

The script supports configurable timeouts, retry attempts, and retry delays via environment variables. Each test retries up to 5 times (configurable) with a 3-second delay between attempts to account for startup latency.

**.github/workflows/deploy-staging.yml (Updated)**
I restructured the workflow into three sequential jobs:

1. **deploy-staging** — Builds and pushes images (unchanged logic)
2. **smoke-test** — Runs after deploy-staging succeeds; executes the smoke test script against the staging URL
3. **rollback-on-failure** — Triggers only if smoke-test fails; determines the previous staging image, initiates rollback, and creates a GitHub incident issue with details about the failure

The rollback criteria are:
- Health endpoint non-responsive after retries
- API documentation unreachable
- Security headers missing
- Network isolation violation (mainnet references in staging)
- Any smoke test failure

When rollback is triggered, the workflow:
- Attempts to identify the previous staging image tag
- Logs the rollback action with the previous image reference
- Creates a GitHub issue labeled `incident`, `rollback`, `staging` with the commit SHA, workflow name, and run ID

### Rollback Criteria
I defined the following automatic rollback triggers:
- Health check endpoint returns non-200 or is unreachable
- API documentation endpoint is unreachable
- Required security headers are missing
- Staging environment exposes mainnet configuration
- Any smoke test fails after the configured retry attempts

---

## 3. Issue 3: Generate OpenAPI from Route Schemas and Test for Drift

### Problem
The OpenAPI specification in `swagger.js` was manually maintained and had fallen out of sync with the actual route implementations. Several routes (webhooks, analytics export, tips leaderboard, auth refresh) were missing from the spec, and there was no automated way to detect this drift.

### What I Changed

**scripts/generate-openapi.js (New)**
I created a script that generates a complete OpenAPI 3.0 specification from structured schema and path definitions. The script:

- Defines 26 schemas as JavaScript objects (including request/response types for webhooks, exports, and all existing entities)
- Defines 33 paths with their HTTP methods, parameters, request bodies, and responses
- Resolves `$ref` references by inlining the referenced schema
- Outputs a valid OpenAPI 3.0 JSON file

The schemas and paths are defined as plain JavaScript objects, making them easy to maintain and extend. When a route is added to the application, I add the corresponding path definition to this script.

**backend/__tests__/openapi-drift.test.js (New)**
I created a Jest test suite that detects drift between the generated spec and the committed `swagger.js`. The test verifies:

1. **Path coverage** — All generated paths exist in swagger.js, and vice versa
2. **HTTP method coverage** — All methods (GET, POST, DELETE, etc.) match for each path
3. **Schema coverage** — All generated schemas exist in swagger.js, and vice versa
4. **Spec structure** — The generated spec is valid OpenAPI 3.0 with required fields
5. **Response coverage** — Every path has at least one response defined
6. **Request body awareness** — Logs a note for POST/PUT/DELETE operations without requestBody (informational, not a failure)

The test parses `swagger.js` by locating the `paths` and `schemas` sections via brace-depth tracking, then extracts path names, HTTP methods, and schema names for comparison.

**backend/src/swagger.js (Updated)**
I added the missing routes and schemas to bring the committed spec in sync with the generated spec:

- Added `/api/auth/refresh` — POST endpoint for token refresh
- Added `/api/analytics/{publicKey}/export-schedule` — GET and POST for export scheduling
- Added `/api/analytics/{publicKey}/export-trigger` — POST for manual export trigger
- Added `/api/tips/leaderboard/{creatorPublicKey}` — GET for top tippers
- Added `/api/webhooks` — POST for webhook registration
- Added `/api/webhooks/{publicKey}` — GET for listing webhooks
- Added `/api/webhooks/{id}` — DELETE for removing a webhook
- Added schemas: `Webhook`, `WebhookCreateRequest`, `WebhookRegistrationResponse`, `WebhookListResponse`, `ExportSchedule`, `ExportScheduleRequest`

**package.json (Updated)**
Added convenience scripts:
- `npm run generate:openapi` — Runs the OpenAPI generation script
- `npm run test:openapi` — Runs only the drift detection tests

### How to Use
```bash
# Generate the OpenAPI spec (outputs to backend/src/openapi-generated.json)
npm run generate:openapi

# Run drift detection tests
npm run test:openapi

# If drift is detected, update swagger.js to match the generated spec, or
# update scripts/generate-openapi.js if the swagger.js is the source of truth
```

---

## 4. Issue 4: Document Durable Storage and Queue Boundaries

### Problem
The architecture documentation did not explain the backend's storage model, queue processing patterns, or the boundaries between ephemeral in-memory state and durable on-chain data. Operators and new contributors had no reference for understanding failure modes, scaling limits, or when to introduce persistent storage.

### What I Changed

**docs/storage-queue-boundaries.md (New)**
I created a comprehensive 300-line document covering:

**Storage Architecture**
- Diagram of the hybrid persistence model (in-memory backend + on-chain Stellar state)
- Explanation of why the backend uses in-memory storage by design, not by omission

**In-Memory Storage Boundaries**
- Detailed breakdown of each storage module: webhookStore, tipsService, turretsService, usernameService, analytics cache
- For each module: data structure, access patterns, size bounds, failure impact, and recovery procedure
- Characteristics table: lifetime (process-scoped), persistence (none), replication (none), consistency (single-threaded)

**Queue Processing Patterns**
- Three processing patterns documented: Turrets Evaluation Runner (setInterval), Webhook Delivery (Promise.allSettled), Payment Monitor (SSE Stream)
- For each: trigger mechanism, concurrency model, error handling, backpressure strategy, ordering guarantees, durability
- Diagram showing the flow of data through each queue

**Queue Boundary Decisions**
- Rationale for NOT using Redis/RabbitMQ/Kafka (current scale doesn't justify complexity)
- Conditions under which a message queue should be introduced

**Data Durability Matrix**
- Table mapping each data type to its storage location, durability level, recovery method, and authoritative source
- Clear distinction between ephemeral backend state (webhooks, usernames, turrets) and durable on-chain state (payments, tips, streams, escrows)

**Failure Modes and Mitigation**
- Process restart: what is lost and how to recover
- Network partition: Horizon API unreachable, CoinGecko unreachable, webhook endpoint unreachable
- Memory pressure: size bounds and eviction behavior for each capped store

**Scaling Boundaries**
- Current limits table: webhooks (~10,000), turrets (~1,000), SSE streams (~500), analytics cache (~10,000)
- Thresholds for introducing persistent storage (e.g., webhooks > 10,000 → migrate to PostgreSQL)
- Thresholds for introducing a message queue (e.g., delivery latency > 5s → dedicated workers)

**Security Boundaries**
- Secret handling: JWT signing secret, server private key, webhook HMAC secrets, Stellar user keys
- Data isolation: account data access control, webhook secret stripping, Stellar key redaction, rate limiting

**Operational Procedures**
- Backup and recovery: reconstruction from on-chain data rather than restoration
- Monitoring: warning and critical thresholds for memory, store sizes, stream counts, error rates

**Future Evolution**
- Phase 1: Persistent webhook store (current need)
- Phase 2: Message queue for webhook delivery
- Phase 3: Distributed turrets evaluation
- Phase 4: Event sourcing for full audit trail

**docs/architecture.md (Updated)**
Added a new "Ephemeral backend, durable blockchain" design decision section that references the new storage-queue-boundaries.md document.

---

## Files Changed Summary

| File | Action | Issue |
|------|--------|-------|
| `docker-compose.yml` | Modified | 1 |
| `docker-compose.staging.yml` | Modified | 1 |
| `docker-compose.prod.yml` | Modified | 1 |
| `scripts/validate-compose.js` | Created | 1 |
| `secrets/.gitkeep` | Created | 1 |
| `.gitignore` | Modified | 1 |
| `scripts/smoke-test.js` | Created | 2 |
| `.github/workflows/deploy-staging.yml` | Modified | 2 |
| `scripts/generate-openapi.js` | Created | 3 |
| `backend/__tests__/openapi-drift.test.js` | Created | 3 |
| `backend/src/swagger.js` | Modified | 3 |
| `backend/package.json` | Modified | 3 |
| `docs/storage-queue-boundaries.md` | Created | 4 |
| `docs/architecture.md` | Modified | 4 |
| `package.json` | Modified | 1, 2, 3 |

---

## Verification

I verified all changes work correctly:

1. **Docker Compose validation** — `npm run validate:compose` passes for all three environments (warnings about missing secret files are expected before deployment)
2. **Smoke tests** — `node scripts/smoke-test.js` runs all 8 tests with proper retry logic and failure reporting
3. **OpenAPI drift detection** — `npm run test:openapi` passes all 8 tests, confirming the committed swagger.js is in sync with the generated spec
4. **OpenAPI generation** — `node scripts/generate-openapi.js` produces a valid 33-path, 26-schema OpenAPI 3.0 specification
5. **Existing tests** — All previously passing tests (116 tests across validateEnv, sanitization, and openapi-drift) continue to pass

---

## Design Decisions

1. **Regex-based parsing over YAML library** — I chose regex parsing for the validation and drift detection scripts to avoid adding dependencies. The parsing is scoped to known file structures and handles the specific formats used in this codebase.

2. **In-memory storage as a feature** — The storage documentation explicitly frames the backend's in-memory design as intentional, not a gap. This reduces operational complexity and attack surface while the blockchain serves as the authoritative data layer.

3. **Best-effort webhook delivery** — I documented that webhook delivery has no retry queue by design. Introducing one is a future phase triggered by specific latency or reliability thresholds.

4. **Rollback creates an issue** — Rather than silently rolling back, the workflow creates a GitHub incident issue. This ensures visibility and creates a paper trail for post-incident review.

5. **OpenAPI generation as source of truth** — The `generate-openapi.js` script is the canonical definition of the API surface. The committed `swagger.js` must stay in sync, enforced by the drift detection test in CI.

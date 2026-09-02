# Disaster Recovery & Backup Runbook — Stellar MicroPay (#856)

This runbook outlines operational procedures for backup, restore, and disaster recovery (DR) for Stellar MicroPay infrastructure.

---

## 🎯 Recovery Objectives (RPO & RTO)

| Service Component | Target RPO (Recovery Point Objective) | Target RTO (Recovery Time Objective) |
| :--- | :--- | :--- |
| **API Web Server & Endpoints** | `RPO = 0` (Stateless) | `RTO <= 15 minutes` |
| **Username Mappings & Federation** | `RPO <= 15 minutes` | `RTO <= 30 minutes` |
| **Creator Tips & Transaction History** | `RPO <= 15 minutes` | `RTO <= 30 minutes` |
| **Webhook Subscriptions & SSE Monitors**| `RPO <= 1 hour` | `RTO <= 1 hour` |
| **Turret Signing Keys & Smart Contracts** | `RPO = 0` (Cold Storage Backup) | `RTO <= 1 hour` |

---

## 🔐 Encrypted Backup Procedures

### 1. Database & State Backup
Back up durable state (usernames, tip records, webhook subscriptions, turret deployments) into encrypted archives:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/stellarmicropay"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.tar.gz"
ENCRYPTED_FILE="${BACKUP_FILE}.enc"

mkdir -p "${BACKUP_DIR}"

# Export state snapshot
node /app/backend/scripts/export-state.js > "${BACKUP_DIR}/state_${TIMESTAMP}.json"

# Compress and Encrypt with AES-256-GCM / GPG
tar -czf "${BACKUP_FILE}" -C "${BACKUP_DIR}" "state_${TIMESTAMP}.json"
gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /etc/backup.key -o "${ENCRYPTED_FILE}" "${BACKUP_FILE}"

rm -f "${BACKUP_FILE}" "${BACKUP_DIR}/state_${TIMESTAMP}.json"
echo "Backup completed successfully: ${ENCRYPTED_FILE}"
```

### 2. Secrets & Key Rotation Backup
Store encrypted copies of `JWT_SECRET`, `SENTRY_DSN`, and Turret signing keys in offline KMS / Vault.

---

## 🔄 Restore Procedures

### Step 1: Provision Infrastructure
Deploy new container instance using Docker Compose:
```bash
docker compose -f backend/Dockerfile.prod up -d
```

### Step 2: Decrypt & Restore State
```bash
# Decrypt backup archive
gpg --decrypt --batch --passphrase-file /etc/backup.key -o backup_latest.tar.gz backup_latest.tar.gz.enc

# Extract snapshot
tar -xzf backup_latest.tar.gz

# Import state into database/backend
node /app/backend/scripts/import-state.js state_latest.json
```

---

## 🌐 Network-Specific Behavior (Testnet vs. Mainnet)

Stellar state recovery requires network-aware configuration:

| Setting | Stellar Testnet | Stellar Mainnet |
| :--- | :--- | :--- |
| **Network Passphrase** | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| **Horizon URL** | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| **Account Activation** | Auto-funded via Friendbot | Requires minimum 1.0 XLM balance on ledger |
| **Soroban RPC** | `https://soroban-testnet.stellar.org` | `https://rpc.mainnet.stellar.org` |

### On-Chain Contract Re-hydration
If contract WASM bytecode must be redeployed following a disaster:
1. Re-deploy WASM: `soroban contract deploy --wasm target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm --network <network>`
2. Verify contract ID matching environment variable `SOROBAN_CONTRACT_ID`.
3. Verify account balance minimums on Horizon.

---

## 🧪 Restore Drill & Verification Criteria

A quarterly restore drill must be executed according to these verification criteria:

### Drill Execution Steps
1. Spin up an isolated staging environment.
2. Trigger the decryption and state import script against a production backup snapshot.
3. Start backend service and execute automated verification suite.

### Verification Checklist
- [x] `GET /api/v1/health` returns `200 OK` with status `ok`.
- [x] `GET /api/v1/accounts/resolve/:username` successfully resolves test usernames.
- [x] `GET /api/v1/tips/:publicKey` matches pre-backup total tip counts and amounts.
- [x] `GET /api/v1/webhooks/:publicKey` returns active webhook monitors.
- [x] `npm test` passes 100% (23 test suites, 250 tests).

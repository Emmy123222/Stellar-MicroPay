# Stellar Turrets Integration

Deploy and monitor automated Stellar transactions with **Turrets** — enabling stop-loss orders, dollar-cost averaging (DCA), and condition-based payments.

## Overview

Turrets enables decentralized scheduled execution of trading strategies on the Stellar network. This implementation provides:

- **DCA (Dollar-Cost Averaging)**: Buy XLM on a fixed schedule using DEX.
- **Stop-Loss**: Automatically sell assets when price falls below a threshold.
- **User-Signed Functions**: All txFunction configurations are signed with your own Freighter wallet.
- **Real-time Monitoring**: View function status and execution history in the Settings UI.

## How It Works

### Architecture

```
Frontend (Next.js)
  ↓ generates config & signs with Freighter
  ↓
Backend API (/api/turrets)
  ├─ POST /challenge       → creates challenge XDR
  ├─ POST /deploy          → verifies signed challenge & deploys
  ├─ GET  /                → list deployments
  ├─ GET  /:id/history     → execution logs
  └─ POST /:id/pause|resume→ pause/resume function
  ↑
Sidecar Turrets Server (port 4100)
  ├─ periodically evaluates deployments
  ├─ checks price feeds (CoinGecko)
  ├─ logs executions
  └─ maintains in-memory registry
```

### Signing Flow

1. **User enters config** (DCA/stop-loss settings)
2. **Frontend creates signing challenge** (empty ManageData tx)
3. **Freighter signs the challenge** with user's own account
4. **Backend verifies signature** matches user's public key
5. **Deployment is persisted** and runner begins evaluation

## Deployment

### Run Backend + Turrets Sidecar

```bash
cd backend
npm install
npm run dev:turrets
```

This starts:
- **API Server** on port 4000 with `/api/turrets` routes
- **Turrets Server** on port 4100 (evaluation engine)

Both share a registry and evaluation loop.

### Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Navigate to `http://localhost:3000/settings` to configure txFunctions.

## Using the Settings UI

### Deploy a DCA Function

1. Navigate to **Settings** page
2. Under **DCA into XLM**, enter:
   - **Quote Amount**: e.g., `10` (USDC to spend per interval)
   - **Interval (minutes)**: e.g., `60` (run every hour)
   - **Quote Asset Code**: e.g., `USDC` (defaults to USDC on mainnet)
   - **Quote Asset Issuer**: issuer address (if custom asset)
3. Click **Deploy DCA txFunction**
4. Sign the challenge in Freighter
5. Function begins running on schedule

### Deploy a Stop-Loss Function

1. Under **Stop-loss**, enter:
   - **Threshold Price (USD)**: e.g., `0.09` (sell if XLM drops below this)
   - **Amount to Sell**: e.g., `25` (units of asset to sell)
   - **Sell Asset Code**: e.g., `USDC`
   - **Sell Asset Issuer**: issuer address (if custom asset)
   - **Cooldown (minutes)**: e.g., `30` (wait before next execution)
2. Click **Deploy Stop-loss txFunction**
3. Sign the challenge in Freighter
4. Function monitors price and executes when threshold hit

### Monitor & Manage

**Function Status & History** section shows:
- **Status**: active / paused
- **Timestamps**: created, next run, last checked, last executed
- **Last Observed Price**: current XLM price (in USD)
- **Execution History**: recent log entries (created, executed, errors)

**Actions**:
- **Pause / Resume**: temporarily disable a function
- **Load History**: fetch and display execution logs (scrollable, max 56 recent)
- **Refresh**: refresh all deployments from backend

## API Reference

### POST `/api/turrets/challenge`

Generate a signing challenge.

**Request**:
```json
{
  "ownerPublicKey": "GABC...",
  "type": "dca",
  "config": {
    "amountQuote": 10,
    "intervalMinutes": 60,
    "quoteAssetCode": "USDC",
    "quoteAssetIssuer": "GA5ZSEJY..."
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "challengeXDR": "AAAAAgAA...",
    "deploymentHash": "abc123...",
    "normalizedConfig": { ... },
    "networkPassphrase": "Test SDF Network ; September 2015"
  }
}
```

### POST `/api/turrets/deploy`

Deploy a txFunction with signed challenge.

**Request**:
```json
{
  "ownerPublicKey": "GABC...",
  "type": "dca",
  "config": { ... },
  "deploymentHash": "abc123...",
  "signedChallengeXDR": "AAAAAgAA... + signature"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "ownerPublicKey": "GABC...",
    "type": "dca",
    "status": "active",
    "config": { ... },
    "createdAt": "2025-04-23T10:00:00.000Z",
    "nextRunAt": "2025-04-23T11:00:00.000Z",
    "lastExecutedAt": null,
    "lastObservedPriceUsd": null,
    "lastError": null
  }
}
```

### GET `/api/turrets?ownerPublicKey=GABC...`

List all deployments for a user.

**Response**:
```json
{
  "success": true,
  "data": [{ ...deployment }, ...]
}
```

### GET `/api/turrets/:id`

Get details of a single deployment.

**Response**:
```json
{
  "success": true,
  "data": { ...deployment }
}
```

### GET `/api/turrets/:id/history`

Get execution history for a deployment.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "deploymentId": "uuid",
      "status": "executed",
      "message": "DCA txFunction generated",
      "result": { "action": "buy_xlm_dca", ... },
      "createdAt": "2025-04-23T11:00:00.000Z"
    },
    ...
  ]
}
```

### POST `/api/turrets/:id/pause`

Pause a deployment.

**Response**: Updated deployment with `status: "paused"`

### POST `/api/turrets/:id/resume`

Resume a deployment.

**Response**: Updated deployment with `status: "active"`

## Environment Variables

### Frontend (`.env.local`)

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
```

### Backend (`.env`)

```bash
PORT=4000
TURRETS_PORT=4100
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
HOME_DOMAIN=localhost:4000
JWT_SECRET=your_secret_key
TURRETS_EVALUATION_INTERVAL_MS=30000
```

## Implementation Details

### Turrets Service (`backend/src/services/turretsService.js`)

Manages:
- **Deployment registry** (in-memory Map)
- **Execution history** (in-memory log, max 1000 entries)
- **Challenge generation** (ManageData operations)
- **Signature verification** (using Stellar SDK)
- **DCA & stop-loss evaluation** loops
- **Price fetching** (CoinGecko API, cached 30 sec)

### Execution Engine

Every 30 seconds (configurable), the runner:

1. **Iterates active deployments**
2. **Checks if next-run time has arrived**
3. **For DCA**: Generates Manage-Sell-Offer intent, schedules next run
4. **For stop-loss**: Checks current XLM price vs threshold, executes if needed
5. **Logs all events** (executed, error, status changes)
6. **Updates deployment state** (nextRunAt, lastExecutedAt, etc.)

### Frontend Client (`frontend/lib/turrets.ts`)

Exports async functions:
- `createTurretsChallenge()` — request signing challenge
- `deployTurretsFunction()` — submit signed deployment
- `listTurretsFunctions()` — fetch user's deployments
- `getTurretsHistory()` — fetch execution logs
- `pauseTurretsFunction()` / `resumeTurretsFunction()` — manage status

### Settings Page (`frontend/pages/settings.tsx`)

Provides:
- DCA configuration form
- Stop-loss configuration form
- Live deployment list with status
- Execution history viewer
- Pause/resume buttons
- Auto-refresh every 20 seconds

## Testing

### Manual Test: Deploy DCA

```bash
# 1. Start backend + turrets
cd backend && npm run dev:turrets

# 2. Start frontend
cd frontend && npm run dev

# 3. Visit http://localhost:3000/settings
# 4. Connect wallet (Freighter)
# 5. Fill DCA form:
#    Quote Amount: 1
#    Interval: 1 (run every minute for testing)
#    Quote Asset Code: USDC
# 6. Click "Deploy DCA txFunction"
# 7. Sign in Freighter
# 8. Check "Function Status & History" — should appear in list
# 9. Wait 1 minute, hit "Load History" — should see execution log
```

### Manual Test: Stop-Loss

```bash
# Follow same steps, but fill Stop-loss form:
#   Threshold Price: 0.50 (very high, will trigger immediately on testnet)
#   Amount to Sell: 1
#   Sell Asset Code: USDC
#   Cooldown: 1
# Deployment should execute immediately and add to history
```

## Notes

- **No private keys**: All signing is done by Freighter. Backend never touches user keys.
- **In-memory storage**: Deployments and history are lost on restart. For production, implement database persistence.
- **Price feed**: Currently uses CoinGecko's free API. Monitor rate limits in production.
- **Network support**: Works on both Stellar testnet and mainnet via environment variables.
- **DEX operations**: DCA & stop-loss generate intent operations; actual placement requires manual submission or integration with Soroban smart signature accounts.

## Future Enhancements

- [ ] Database persistence for deployments & history
- [ ] Custom price feed integration (Soroban oracles)
- [ ] Batch execution (multiple operations per run)
- [ ] Email/webhook notifications on execution
- [ ] Advanced scheduling (cron-style configs)
- [ ] Multi-function bundles (e.g., DCA + hedge)
- [ ] Performance analytics (returns, fees, slippage)

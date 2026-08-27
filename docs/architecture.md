# Architecture — Stellar MicroPay

## Overview

Stellar MicroPay is a three-tier Web3 application:

```
┌─────────────────────────────────────────────────────────────────┐
│                         User's Browser                          │
│                                                                 │
│   ┌──────────────────────┐    ┌────────────────────────────┐   │
│   │   Next.js Frontend   │    │    Freighter Extension     │   │
│   │  (React + Tailwind)  │◄──►│   (Stellar Wallet)         │   │
│   └──────────┬───────────┘    └────────────────────────────┘   │
└──────────────┼──────────────────────────────────────────────────┘
               │ HTTP (REST)
               ▼
┌──────────────────────────┐
│   Node.js Backend API    │
│   (Express)              │
│                          │
│  • Account lookups       │
│  • Payment history       │
│  • Username resolution   │
└──────────────┬───────────┘
               │ Horizon REST API
               ▼
┌──────────────────────────┐       ┌──────────────────────────┐
│   Stellar Horizon API    │◄─────►│   Stellar Network        │
│   (horizon-testnet       │       │   (Validators)           │
│    .stellar.org)         │       │                          │
└──────────────────────────┘       └──────────────────────────┘
                                              ▲
                                              │ Soroban
                                   ┌──────────────────────────┐
                                   │   Soroban Smart Contract │
                                   │   (Rust/WASM)            │
                                   │                          │
                                   │  • Tip recording         │
                                   │  • Payment streams       │
                                   │  • Escrow (time-locked)  │
                                   └──────────────────────────┘
```

## Payment Flow

```
User fills form ──► Build TX (Stellar SDK) ──► Sign (Freighter)
                                                      │
                                                      ▼
View on Explorer ◄── Success ◄── Submit to Horizon Network
```

### Step-by-step

1. **User inputs** destination address, amount, optional memo
2. **Frontend** builds an unsigned Stellar transaction using `stellar-sdk`
3. **Freighter** prompts the user to review and sign the transaction
4. **Frontend** submits the signed XDR to Stellar's Horizon API
5. **Horizon** broadcasts the transaction to the Stellar validator network
6. **Network** confirms the transaction in 3–5 seconds
7. **Frontend** polls or receives the confirmed transaction hash

## Key Design Decisions

### Non-custodial
Private keys never leave the user's device. Freighter handles all signing locally in the browser extension.

### Client-side transactions
Transaction building and submission happen directly in the browser via the Stellar SDK. The backend is not required for core payment functionality — this reduces attack surface.

### Backend as optional enhancement
The Node.js backend provides:
- Username-to-address resolution (future)
- Cached payment history for performance
- Analytics and aggregation

If the backend is down, users can still send payments via the frontend.

### Testnet first
The default configuration targets Stellar Testnet. Switching to Mainnet requires only an environment variable change.

### Contract storage is versioned, not implicitly migrated
Soroban upgrades replace the WASM but keep the contract id and every storage
entry, so old data is handed to the new build untouched. The contract records
the layout its data was written for under `DataKey::SchemaVersion`
(`get_schema_version()`), and the admin-gated `migrate()` advances it after an
upgrade. Storage-shape changes therefore ship as an explicit, ordered
procedure — publish WASM, rewrite affected entries, stamp the version —
rather than as a silent reinterpretation of existing bytes.

Full version table, the rules for what counts as a breaking storage change,
and the step-by-step upgrade/rollback procedure live in
[contracts/stellar-micropay-contract/README.md](../contracts/stellar-micropay-contract/README.md#upgrades-and-storage-migration-562).

### Ephemeral backend, durable blockchain
The backend uses in-memory storage for operational state (webhooks, tips, usernames, turrets). All financial data is anchored on-chain via Soroban smart contracts and the Stellar ledger. See [storage-queue-boundaries.md](./storage-queue-boundaries.md) for the full durability model, queue processing patterns, and scaling boundaries.

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Private key exposure | Freighter handles signing — keys never touch the app |
| Transaction replay | Stellar sequence numbers prevent replays |
| Man-in-the-middle | HTTPS enforced; Horizon API uses TLS |
| Malicious destination | User confirms destination in Freighter before signing |
| Rate abuse | Express rate limiter on backend API |
| XSS | React's default escaping; no `dangerouslySetInnerHTML` |

## File Dependency Map

```
pages/
  _app.tsx          ← Global wallet state (publicKey)
  index.tsx         ← Landing page + WalletConnect
  dashboard.tsx     ← Balance + SendPaymentForm + TransactionList
  transactions.tsx  ← Full TransactionList

components/
  WalletConnect.tsx ← Uses lib/wallet.ts
  SendPaymentForm.tsx ← Uses lib/stellar.ts + lib/wallet.ts
  TransactionList.tsx ← Uses lib/stellar.ts
  Navbar.tsx         ← Uses lib/stellar.ts (shortenAddress)

lib/
  stellar.ts  ← Horizon API calls, TX building, TX submission
  wallet.ts   ← Freighter integration (connect, sign)

utils/
  format.ts   ← XLM formatting, date formatting, clipboard
```

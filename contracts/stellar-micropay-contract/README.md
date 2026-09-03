# Stellar MicroPay — Soroban Contract

This directory contains the Soroban smart contract for Stellar MicroPay.

## Overview

The contract is written in Rust and compiled to WebAssembly (WASM) for deployment on the Stellar network via Soroban.

**Current features (v0.1):**
- Contract initialization with admin
- On-chain tip recording with event emission
- Tip total and count queries per recipient
- Placeholder stubs for escrow and batch payments

## Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI
cargo install --locked stellar-cli
```

## Build

```bash
cargo build --target wasm32-unknown-unknown --release
```

Output: `target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm`

## Test

```bash
cargo test
```

## Deploy to Testnet

```bash
# Configure your identity
stellar keys generate --global alice --network testnet

# Fund with Friendbot
stellar keys fund alice --network testnet

# Deploy
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm \
  --source alice \
  --network testnet
```

## Invoke

```bash
# Initialize
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- initialize \
  --admin <YOUR_PUBLIC_KEY>

# Send a tip
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- send_tip \
  --token_address <XLM_SAC_ADDRESS> \
  --from <SENDER_ADDRESS> \
  --to <RECIPIENT_ADDRESS> \
  --amount 1000000

# Check tip total
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_tip_total \
  --recipient <RECIPIENT_ADDRESS>
```

## Troubleshooting (#153)

The CLI commands above only work if the contract compiles — and as of this
writing `src/lib.rs` carries unresolved merge residue that blocks
`cargo build`:

- ~~Two `DataKey` enums were defined at module scope.~~ Merged into one in
  this PR — both sets of variants are needed by the contract methods.
- `impl MicroPayContract { ... }` should be `impl StellarMicroPay`. The
  `initialize` function lost its signature in the same merge — its body
  starts directly after the section comment. A standalone follow-up issue
  needs to reconstruct the function signatures by walking the original
  PRs (`git log -p src/lib.rs`).
- Several other methods (`send_tip`, `close_stream`, etc.) appear to have
  bodies that reference identifiers from neighboring functions, suggesting
  more than one merge dropped function boundaries.

If `cargo build --target wasm32-unknown-unknown --release` fails with
"unexpected closing delimiter" or "cannot find type", check `git blame`
around the offending line first — most of the breakage looks like
incomplete merge resolutions, not real logic bugs. Until the contract
compiles, `stellar contract deploy` has no `.wasm` artifact to upload, so
every CLI step from "Deploy to Testnet" onward is blocked.

## XLM SAC Address (Testnet)

The Stellar Asset Contract address for native XLM on testnet:
```
CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

## Roadmap

- **v2.1** — Escrow payments with time-lock release
- **v2.0** — Batch micro-payment transactions
- **v1.4** — Creator tip pages

See [ROADMAP.md](../../ROADMAP.md) for full details.

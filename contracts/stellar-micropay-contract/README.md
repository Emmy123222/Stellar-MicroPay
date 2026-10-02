# Stellar MicroPay — Soroban Contract

This directory contains the Soroban smart contract for Stellar MicroPay.

## Overview

The contract is written in Rust and compiled to WebAssembly (WASM) for deployment on the Stellar network via Soroban.

**Current features (v0.1):**
- Contract initialization with admin
- On-chain tip recording with event emission
- Tip total and count queries per recipient
- Optional operator fee (basis points) collected on every tip
- Streaming payments (open/claim/top-up/close, with pause/resume)
- Time-locked escrow (open/release/cancel)
- Milestone escrow: funds held by the contract, released by a designated
  approver, or reclaimed by the payer once a dispute times out
- Placeholder stub for batch payments

## Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add Soroban WASM target
rustup target add wasm32v1-none

# Install Stellar CLI
cargo install --locked stellar-cli
```

## Build

```bash
stellar contract build --package stellar-micropay-contract --optimize=false
```

The Soroban SDK 28 build uses the `wasm32v1-none` target. The raw release
artifact is written to
`target/wasm32v1-none/release/stellar_micropay_contract.wasm`.

## WASM Size Optimization

Keep the deployed contract WASM below **50 KB**. The release profile in the
workspace root already enables size-oriented optimization, LTO, one codegen
unit, and symbol stripping. Soroban contracts should use `#![no_std]`; avoid
enabling `std` features on guest dependencies unless they are required. Prefer
small dependencies and avoid pulling in unused features. The `testutils` SDK
feature belongs in dev-dependencies only, as it is for this contract.

Install Binaryen to use `wasm-opt`, then build the unoptimized Soroban artifact
and run the size optimizer:

```bash
# Build with Cargo's release profile, without the CLI's wasm-opt pass
stellar contract build --package stellar-micropay-contract --optimize=false

# Apply Binaryen's most aggressive size optimization
wasm-opt -Oz \
  target/wasm32v1-none/release/stellar_micropay_contract.wasm \
  -o target/wasm32v1-none/release/stellar_micropay_contract.opt.wasm

# Print exact byte counts
stat -c '%n: %s bytes' \
  target/wasm32v1-none/release/stellar_micropay_contract.wasm \
  target/wasm32v1-none/release/stellar_micropay_contract.opt.wasm
```

The Stellar CLI build summary also reports the WASM size. To inspect the
contract interface and exported functions, run:

```bash
stellar contract inspect --wasm \
  target/wasm32v1-none/release/stellar_micropay_contract.opt.wasm
```

`contract inspect` prints contract specification details, not the file's byte
size; use `stat` above for the exact size.

Measured using Soroban SDK 28.0.0, Rust 1.93.1, Stellar CLI 28.1.0, and the
workspace release profile:

| Artifact | Size |
| --- | ---: |
| Cargo release WASM, before `wasm-opt` | 9,160 bytes (8.95 KiB) |
| WASM after `wasm-opt -Oz` | 8,006 bytes (7.82 KiB) |

Both are under the 50 KB budget. Re-measure after changing contract code,
dependencies, or compiler/SDK versions; WASM sizes can vary between toolchains.

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
  --wasm target/wasm32v1-none/release/stellar_micropay_contract.wasm \
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

# Set the operator fee (in basis points, e.g. 50 = 0.5%, capped at 500 = 5%)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- set_fee_bps \
  --admin <YOUR_PUBLIC_KEY> \
  --fee_bps 50
```

## Milestone escrow

Funds are held by the contract until a third-party `approver` confirms the
milestone. The payer can freeze the escrow by disputing it, and gets the funds
back once `dispute_timeout` ledgers have elapsed.

```bash
# Lock funds: payer -> contract, released to recipient by approver
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- create_milestone_escrow \
  --token <XLM_SAC_ADDRESS> \
  --payer <PAYER_ADDRESS> \
  --recipient <RECIPIENT_ADDRESS> \
  --amount 5000000 \
  --approver <APPROVER_ADDRESS> \
  --dispute_timeout 500

# Release the funds to the recipient (approver only, escrow must be pending)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source carol \
  --network testnet \
  -- approve_milestone \
  --escrow_id 0 \
  --approver <APPROVER_ADDRESS>

# Freeze the funds pending resolution (payer only)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- dispute_milestone \
  --escrow_id 0 \
  --payer <PAYER_ADDRESS>

# Reclaim a disputed escrow after the timeout has elapsed (payer only)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- cancel_milestone_escrow \
  --escrow_id 0 \
  --payer <PAYER_ADDRESS>

# Read the escrow record (status: pending / approved / disputed / cancelled)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_milestone_escrow \
  --escrow_id 0
```

Every state change publishes a `milestone_escrow` event whose second topic is
`created`, `approved`, `disputed` or `cancelled`, followed by the escrow id and
the address that authorised the change, so indexers can follow an escrow without
reading storage.

Rules the contract enforces:

| Action | Who | Preconditions |
| --- | --- | --- |
| `create_milestone_escrow` | payer | `amount > 0`, `0 < dispute_timeout <= 50000` ledgers |
| `approve_milestone` | the escrow's `approver` | status `pending` |
| `dispute_milestone` | the escrow's `payer` | status `pending` |
| `cancel_milestone_escrow` | the escrow's `payer` | status `disputed` and `dispute_timeout` ledgers elapsed since the dispute |

A disputed escrow can no longer be approved: once the payer disputes, the only
ways out are the payer reclaiming the funds after the timeout, or waiting it out
and creating a new escrow.

## Troubleshooting (#153)

Soroban SDK 28 requires the Stellar CLI to set build metadata and the
`wasm32v1-none` target on current Rust toolchains. Build with
`stellar contract build` as shown above; a direct `cargo build` or the old
`wasm32-unknown-unknown` target may fail even when the contract source is valid.

## Error Reference

The contract does not define a `#[contracterror]` enum — every failure is a
plain `panic!` or `.expect()` call, so there is no numeric error code to
match on client-side. Instead, catch the failed invocation and match on the
panic message (available in the transaction's diagnostic events when
simulated or submitted with debug info enabled).

| Error message                                       | Trigger condition                                                                 | Affected function(s)                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| `Contract already initialized`                       | `initialize` is called a second time (the `Admin` storage key is already set).      | `initialize`                                      |
| `Contract not initialized`                            | A function that requires the admin address reads it before `initialize` was called. | `get_admin`, `send_tip`, `set_fee_bps`            |
| `Tip amount must be positive`                         | `send_tip` is called with `amount <= 0`.                                            | `send_tip`                                        |
| `Tip record not found`                                | `get_tip_record` is called with a `(recipient, index)` pair that was never stored.  | `get_tip_record`                                  |
| `Receipt amount must be positive`                     | `mint_receipt` is called with `amount <= 0`.                                        | `mint_receipt`                                    |
| `Receipt not found`                                   | `get_receipt` is called with a `(payer, index)` pair that was never stored.         | `get_receipt`                                     |
| `Only the admin can set the fee`                      | `set_fee_bps` is called with an `admin` argument that doesn't match the stored admin, even if that address authorized the call. | `set_fee_bps`      |
| `Fee exceeds maximum allowed (500 bps)`               | `set_fee_bps` is called with `fee_bps > 500` (the 5% cap).                          | `set_fee_bps`                                     |
| `Escrow payments coming in v2.1 — see ROADMAP.md`     | `create_escrow` is called at all — it's an unimplemented placeholder.               | `create_escrow`                                   |
| `Batch payments coming in v2.0 — see ROADMAP.md`      | `batch_send` is called at all — it's an unimplemented placeholder.                  | `batch_send`                                      |

`send_tip` and `mint_receipt` also panic implicitly if the caller isn't the
address that authorized the invocation (`from.require_auth()` /
`admin.require_auth()` failing), which the Soroban host reports as its own
authorization error rather than one of the messages above.

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

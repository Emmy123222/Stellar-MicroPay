# Stellar MicroPay — Soroban Contract

This directory contains the Soroban smart contract for Stellar MicroPay.

## Overview

The contract is written in Rust and compiled to WebAssembly (WASM) for deployment on the Stellar network via Soroban.

**Current features (v0.1):**
- Contract initialization with admin
- On-chain tip recording with event emission
- Tip total and count queries per recipient
- Optional operator fee (basis points) collected on every tip
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

# Set the operator fee (in basis points, e.g. 50 = 0.5%, capped at 500 = 5%)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- set_fee_bps \
  --admin <YOUR_PUBLIC_KEY> \
  --fee_bps 50
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

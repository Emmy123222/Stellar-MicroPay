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

# Only the WASM-upgrade tests, with the before/after state printed
cargo test upgrade -- --nocapture
```

The upgrade tests swap the contract's executable for
`test_wasm/stub_new_wasm.wasm` (a 639-byte WASM blob checked into the repo, so
`cargo test` needs no stellar-cli build step) and then assert that every stored
tip, receipt and the admin address survive the swap.

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

## Soroban error reference (#1217)

Every failure this contract can produce, its trigger, and the functions that
raise it. There is no per-error numeric code: a panic in the WASM is always
reported to the caller as `Error(WasmVm, InvalidAction)`, and only the text in
the *Diagnostic* column survives — in a diagnostic event, not in the returned
code. So key your tooling on the message, not on the code.

| Name | Soroban error | Message / diagnostic text | Trigger condition | Affected functions |
| --- | --- | --- | --- | --- |
| `ALREADY_INITIALIZED` | `Error(WasmVm, InvalidAction)` | `Contract already initialized` | `initialize` is called when `DataKey::Admin` already holds a value. Initialization is one-shot; there is no re-key path. | `initialize` |
| `SENDER_AUTH_REQUIRED` | `Error(Auth, InvalidAction)` | `Unauthorized function call for address` (auth layer, not a panic) | The `from` address did not authorize the call: no matching `Requirement` was signed. | `send_tip`, `mint_receipt` |
| `TIP_AMOUNT_NOT_POSITIVE` | `Error(WasmVm, InvalidAction)` | `Tip amount must be positive` | `amount <= 0`, in the token's smallest unit (stroops for XLM). Checked before the transfer, so no tokens move. | `send_tip` |
| `RECEIPT_AMOUNT_NOT_POSITIVE` | `Error(WasmVm, InvalidAction)` | `Receipt amount must be positive` | `amount <= 0` when minting a receipt. | `mint_receipt` |
| `NOT_INITIALIZED` | `Error(WasmVm, InvalidAction)` | `Contract not initialized` | `get_admin` reads `DataKey::Admin` on a contract nobody has initialized. | `get_admin` |
| `TIP_RECORD_NOT_FOUND` | `Error(WasmVm, InvalidAction)` | `Tip record not found` | `get_tip_record` index is outside `0..get_tip_count(recipient)`. Tip records are stored from index `0` upward, so an index equal to the count is the usual off-by-one. | `get_tip_record` |
| `RECEIPT_NOT_FOUND` | `Error(WasmVm, InvalidAction)` | `Receipt not found` | `get_receipt` index is outside `0..get_receipt_count(payer)`. | `get_receipt` |
| `TOKEN_TRANSFER_FAILED` | whatever the SAC returns (e.g. `Error(Auth, InvalidAction)`, balance/trustline errors) | surfaces from the token contract, not from MicroPay | The underlying `token.transfer` aborts: sender has insufficient balance, is not authorized, or the destination asset needs a trustline. Recorded tips are rolled back with it. | `send_tip` |
| `ESCROW_NOT_IMPLEMENTED` | `Error(WasmVm, InvalidAction)` | `Escrow payments coming in v2.1 — see ROADMAP.md` | Placeholder entry point, still unimplemented on `main`. | `create_escrow` |
| `BATCH_NOT_IMPLEMENTED` | `Error(WasmVm, InvalidAction)` | `Batch payments coming in v2.0 — see ROADMAP.md` | Placeholder entry point, still unimplemented on `main`. | `batch_send` |

Notes that apply to the whole table:

- **A panic is a hard stop.** The invocation aborts and *nothing* is persisted,
  including the admin and counters — see
  `test_panics_are_reported_as_context_invalid_action` in `src/lib.rs`.
- **Storage eviction looks like a new contract.** Tips, receipts and the admin
  all live in *instance* storage, whose TTL is renewed by reads and writes. A
  contract left untouched for longer than the network's maximum entry lifetime
  (65,176 ledgers on pubnet, a few days) has its storage evicted, and the values
  simply read as absent: `get_tip_total` returns `0`, `get_admin` hits
  `NOT_INITIALIZED`. This is the one failure mode that produces no error at the
  call that exposes it.
- **Reading the message.** `stellar contract invoke` prints the diagnostic
  events on a failed simulation; the line looks like
  `["caught panic 'Tip amount must be positive' from contract function ..."]`.

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

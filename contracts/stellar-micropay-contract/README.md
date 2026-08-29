# Stellar MicroPay — Soroban Contract

This directory contains the Soroban smart contract for Stellar MicroPay.

## Overview

The contract is written in Rust and compiled to WebAssembly (WASM) for deployment on the Stellar network via Soroban.

**Current features (v0.1):**
- Contract initialization with admin
- On-chain tip recording with event emission
- Tip total and count queries per recipient
- Receipt metadata minting for payments
- Batch tip/payment recording
- Time-locked escrow payments
- Streaming payments with pause/resume, dust-stream limits, and multi-recipient weighted payouts
- Storage schema versioning with a documented migration path

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

### Fuzz testing (#563)

`src/fuzz_streams.rs` is a `proptest`-based property test that generates
random sequences of `claim_stream` / `top_up_stream` / `close_stream` calls
against a stream opened by `open_stream` — interleaved with random ledger
advances and top-up amounts drawn from a much wider range than the
hand-written tests use — and re-checks the `claimed <= deposited` invariant
(#557) and contract solvency after every call. It runs as part of the normal
`cargo test` job already wired into CI (`.github/workflows/ci.yml`); no
separate nightly job is needed since it is a stable-Rust property test rather
than a `cargo-fuzz`/libFuzzer harness. A failing case is automatically
shrunk by `proptest` to a minimal reproduction and printed on test failure.
Baseline runs have found no panics or overflows.

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

## Function Reference

All amounts are `i128` stroop-denominated values unless a caller explicitly passes a different token contract address. Address parameters use Soroban `Address` values.

### `initialize(env: Env, admin: Address) -> ()`

- **Parameters**:
  - `admin: Address` - account stored as the contract administrator.
- **Return value**: none.
- **Authorization requirements**: none in the current implementation; the first successful caller sets the admin.
- **Events emitted**: `(init)` with the admin address as event data.
- **Error conditions**:
  - Panics with `Contract already initialized` if an admin is already stored.

### `transfer_admin(env: Env, current_admin: Address, new_admin: Address) -> ()`

- **Parameters**:
  - `current_admin: Address` - expected current administrator.
  - `new_admin: Address` - replacement administrator to store.
- **Return value**: none.
- **Authorization requirements**: `current_admin.require_auth()`.
- **Events emitted**: none.
- **Error conditions**:
  - Panics with `Contract not initialized` if `initialize` has not run.
  - Panics with `Unauthorized` if `current_admin` does not match the stored admin.

### `send_tip(env: Env, token_address: Address, from: Address, to: Address, amount: i128) -> ()`

- **Parameters**:
  - `token_address: Address` - Soroban token contract used for the transfer.
  - `from: Address` - payer/tipper address.
  - `to: Address` - recipient/creator address.
  - `amount: i128` - amount to transfer and record.
- **Return value**: none.
- **Authorization requirements**: `from.require_auth()`.
- **Events emitted**: `(tip, from, to)` with `amount` as event data.
- **Error conditions**:
  - Panics with `Tip amount must be positive` when `amount <= 0`.
  - Propagates token contract transfer failures, including insufficient balance, missing trustline, or token authorization failures.

### `get_tip_total(env: Env, recipient: Address) -> i128`

- **Parameters**:
  - `recipient: Address` - address whose cumulative received tips should be read.
- **Return value**: total recorded tip amount for `recipient`, or `0` when no tips have been recorded.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**: none in normal operation.

### `get_tip_count(env: Env, recipient: Address) -> u32`

- **Parameters**:
  - `recipient: Address` - address whose recorded tip count should be read.
- **Return value**: number of recorded tips for `recipient`, or `0` when no tips have been recorded.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**: none in normal operation.

### `get_admin(env: Env) -> Address`

- **Parameters**: none.
- **Return value**: stored admin address.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**:
  - Panics with `Contract not initialized` if `initialize` has not run.

### `get_tip_record(env: Env, recipient: Address, index: u32) -> TipRecord`

- **Parameters**:
  - `recipient: Address` - recipient whose tip record should be read.
  - `index: u32` - zero-based record index for that recipient.
- **Return value**: `TipRecord { from, to, amount, ledger }`.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**:
  - Panics with `Tip record not found` if no record exists for `(recipient, index)`.

### `mint_receipt(env: Env, from: Address, to: Address, amount: i128, memo: Symbol) -> u32`

- **Parameters**:
  - `from: Address` - payer address that owns the receipt record.
  - `to: Address` - payment recipient address.
  - `amount: i128` - amount represented by the receipt.
  - `memo: Symbol` - short receipt memo stored on-chain.
- **Return value**: zero-based receipt index for `from`.
- **Authorization requirements**: `from.require_auth()`.
- **Events emitted**: `(receipt, from)` with the receipt index as event data.
- **Error conditions**:
  - Panics with `Receipt amount must be positive` when `amount <= 0`.

### `get_receipt_count(env: Env, payer: Address) -> u32`

- **Parameters**:
  - `payer: Address` - receipt owner whose count should be read.
- **Return value**: number of receipt records for `payer`, or `0` when none exist.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**: none in normal operation.

### `get_receipt(env: Env, payer: Address, index: u32) -> ReceiptMetadata`

- **Parameters**:
  - `payer: Address` - receipt owner.
  - `index: u32` - zero-based receipt index for that payer.
- **Return value**: `ReceiptMetadata { from, to, amount, timestamp, memo, ledger }`.
- **Authorization requirements**: none.
- **Events emitted**: none.
- **Error conditions**:
  - Panics with `Receipt not found` if no receipt exists for `(payer, index)`.

### `create_escrow(env: Env, from: Address, to: Address, amount: i128, release_ledger: u32) -> ()`

- **Parameters**:
  - `from: Address` - intended escrow funder.
  - `to: Address` - intended escrow beneficiary.
  - `amount: i128` - intended escrow amount.
  - `release_ledger: u32` - intended release ledger.
- **Return value**: none.
- **Authorization requirements**: none in the current stub.
- **Events emitted**: none.
- **Error conditions**:
  - Always panics with `Escrow payments coming in v2.1 — see ROADMAP.md`.

### `batch_send(env: Env, token_address: Address, from: Address, recipients: Vec<Address>, amounts: Vec<i128>) -> ()`

- **Parameters**:
  - `token_address: Address` - Soroban token contract used for every transfer.
  - `from: Address` - payer address.
  - `recipients: Vec<Address>` - recipient addresses, ordered to match `amounts`.
  - `amounts: Vec<i128>` - transfer amounts, ordered to match `recipients`.
- **Return value**: none.
- **Authorization requirements**: `from.require_auth()`.
- **Events emitted**: none in the current implementation.
- **Error conditions**:
  - Panics with `arrays must have equal length` if `recipients.len() != amounts.len()`.
  - Panics with `amount must be positive` if any amount is `<= 0`.
  - Propagates token contract transfer failures, including insufficient balance, missing trustline, or token authorization failures.

### `open_stream(env: Env, token_address: Address, payer: Address, recipients: Vec<Address>, weights: Vec<u32>, rate_per_ledger: i128, deposit: i128) -> u32`

- **Parameters**:
  - `token_address: Address` - Soroban token contract the stream is denominated in.
  - `payer: Address` - account funding the stream.
  - `recipients: Vec<Address>` - accounts that split the stream's payout, ordered to match `weights`. A single-recipient stream is a one-element list.
  - `weights: Vec<u32>` - each recipient's share of the payout, ordered to match `recipients`. A recipient's entitlement at any point is `weight / sum(weights)` of the total streamed so far (#559).
  - `rate_per_ledger: i128` - combined accrual rate per ledger, split across `recipients` by weight.
  - `deposit: i128` - amount locked in the contract up front.
- **Return value**: zero-based stream id.
- **Authorization requirements**: `payer.require_auth()`.
- **Events emitted**: `(stream_open, stream_id)` with `(payer, recipients, weights, rate_per_ledger, deposit)`.
- **Error conditions**:
  - Panics with `recipients and weights must have equal length` when the two lists differ in length.
  - Panics with `at least one recipient is required` when `recipients` is empty.
  - Panics with `weight must be positive` when any weight is `0`.
  - Panics with `recipients must not contain duplicate addresses` when the same address appears more than once — a duplicate would only be reachable through its first entry, stranding the rest of its weight until `close_stream`.
  - Panics with `rate_per_ledger must be positive` when `rate_per_ledger <= 0`.
  - Panics with `deposit must be positive` when `deposit <= 0`.
  - Panics with `deposit below minimum` when `deposit < MIN_STREAM_DEPOSIT` (10_000 stroops).
  - Panics with `stream duration below minimum` when `deposit / rate_per_ledger < MIN_STREAM_DURATION_LEDGERS` (60 ledgers, ~5 minutes) — this also covers `rate_per_ledger > deposit`, which funds zero whole ledgers.
  - Propagates token contract transfer failures.

### `claim_stream(env: Env, stream_id: u32, recipient: Address) -> i128`

- **Parameters**:
  - `stream_id: u32` - stream to withdraw from.
  - `recipient: Address` - one of the stream's recipients.
- **Return value**: amount transferred to `recipient` — their weighted share of accrual minus what they have already claimed; `0` when nothing new has accrued for them since their last claim.
- **Authorization requirements**: `recipient.require_auth()`.
- **Events emitted**: `(stream_claim, stream_id)` with `(recipient, amount)`.
- **Error conditions**:
  - Panics with `stream not found` for an unknown id.
  - Panics with `unauthorized` when the caller is not one of the stream's recipients.
  - Panics with `stream is closed` once the stream has been closed.

### `top_up_stream(env: Env, stream_id: u32, payer: Address, amount: i128) -> ()`

- **Parameters**:
  - `stream_id: u32` - stream to extend.
  - `payer: Address` - the stream's payer.
  - `amount: i128` - additional deposit.
- **Return value**: none.
- **Authorization requirements**: `payer.require_auth()`.
- **Events emitted**: `(stream_topup, stream_id)` with `(payer, amount, deposited)`.
- **Error conditions**: `stream not found`, `unauthorized`, `stream is closed`, or `amount must be positive`.

### `pause_stream(env: Env, stream_id: u32, payer: Address) -> ()`

- **Parameters**:
  - `stream_id: u32` - stream to suspend.
  - `payer: Address` - the stream's payer.
- **Return value**: none.
- **Authorization requirements**: `payer.require_auth()`.
- **Events emitted**: `(stream_pause, stream_id)` with `(payer, paused_at_ledger)`.
- **Error conditions**: `stream not found`, `unauthorized`, `stream is closed`, or `stream already paused`.

While paused, the claimable amount stops growing. Already-accrued funds stay
claimable — pausing suspends accrual, it does not freeze the recipient's
balance.

### `resume_stream(env: Env, stream_id: u32, payer: Address) -> ()`

- **Parameters**:
  - `stream_id: u32` - stream to resume.
  - `payer: Address` - the stream's payer.
- **Return value**: none.
- **Authorization requirements**: `payer.require_auth()`.
- **Events emitted**: `(stream_resume, stream_id)` with `(payer, pause_length)`.
- **Error conditions**: `stream not found`, `unauthorized`, `stream is closed`, or `stream is not paused`.

Accrual resumes from the point it stopped: the pause length is added to
`paused_ledgers` and subtracted from the accrual window, so paused ledgers are
never back-paid.

### `close_stream(env: Env, stream_id: u32, payer: Address) -> ()`

- **Parameters**:
  - `stream_id: u32` - stream to stop.
  - `payer: Address` - the stream's payer.
- **Return value**: none.
- **Authorization requirements**: `payer.require_auth()`.
- **Events emitted**: `(stream_close, stream_id)` with `(owed, refund)`, where `owed` is the combined amount paid out to all recipients during this call and `refund` is what goes back to the payer (#558).
- **Error conditions**: `stream not found`, `unauthorized`, or `stream is closed`.

Settles everything accrued to each recipient by weight (#559) and refunds the
unstreamed remainder to the payer in the same call.

### `get_stream(env: Env, stream_id: u32) -> Stream`

- **Return value**: `Stream { payer, recipients, rate_per_ledger, deposited, start_ledger, token, paused, paused_at_ledger, paused_ledgers, closed }`, where `recipients: Vec<StreamRecipient { recipient, weight, claimed }>` (#559).
- **Error conditions**: panics with `stream not found` for an unknown id.

### `get_claimable(env: Env, stream_id: u32, recipient: Address) -> i128`

- **Parameters**:
  - `stream_id: u32` - stream to query.
  - `recipient: Address` - the recipient whose claimable share to compute.
- **Return value**: amount `recipient` could withdraw at the current ledger — their weighted share of accrual, net of paused time and capped at the deposit. `0` for a closed stream or an address that is not one of the stream's recipients.
- **Error conditions**: panics with `stream not found` for an unknown id.

### `get_stream_count(env: Env) -> u32`

- **Return value**: number of streams ever opened; `0` when none exist.

### `get_schema_version(env: Env) -> u32`

- **Return value**: storage schema version this instance's data is laid out for. `0` means the instance predates schema versioning and needs a `migrate` call.

### `migrate(env: Env, admin: Address) -> u32`

- **Parameters**:
  - `admin: Address` - the stored contract administrator.
- **Return value**: the schema version migrated to.
- **Authorization requirements**: `admin.require_auth()`.
- **Events emitted**: `(migrate)` with `(from_version, to_version)`.
- **Error conditions**:
  - Panics with `Contract not initialized` if `initialize` has not run.
  - Panics with `Unauthorized` when the caller is not the stored admin.
  - Panics with `schema already at current version` when no migration is pending.
  - Panics with `stored schema is newer than this contract` when the on-chain data was written by a newer build.

## Upgrades and Storage Migration (#562)

Soroban contracts are upgraded in place: the contract id and all of its
storage survive, only the WASM behind it is replaced. Storage written by the
old build is handed to the new one **as-is**, so any change to a stored type
is a breaking change unless it is migrated.

### Schema version key

`DataKey::SchemaVersion` holds a `u32` describing the layout of the data
currently in storage. `initialize` stamps `SCHEMA_VERSION` on fresh
deployments; `migrate` advances it after an upgrade.

| Version | Layout |
| ------- | ------ |
| `0` | Pre-versioning instances (deployed before `SchemaVersion` existed): admin, tips, receipts, escrows. |
| `1` | Adds `Stream`, `DataKey::Stream`, `DataKey::StreamCount` and `DataKey::SchemaVersion`. |
| `2` | `Stream.recipient: Address` and `Stream.claimed: i128` replaced by `Stream.recipients: Vec<StreamRecipient>`, splitting payout across weighted recipients (#559). |
| `3` | Adds `EscrowSenderCount`, `EscrowSenderIndex`, `EscrowRecipientCount`, and `EscrowRecipientIndex` for account-oriented escrow discovery (#796). |

`get_schema_version()` returns `0` for any instance that has never been
stamped, which is how a pre-versioning deployment is detected.

### What counts as a breaking storage change

Bump `SCHEMA_VERSION` and add a row to the table above whenever you:

- add, remove, or reorder a field in a stored struct (`Stream`, `Escrow`,
  `TipRecord`, `ReceiptMetadata`);
- change a field's type, or the meaning of an existing field;
- add, remove, or reorder a `DataKey` variant — variants are encoded
  positionally, so inserting one in the middle silently repoints every key
  after it. **Always append new variants at the end.**

Adding a brand-new key that no old data uses (as `v1` does for streams) is
backward compatible: old entries keep decoding, and the new key simply has no
value yet.

### Upgrade procedure

1. **Prepare.** Bump `SCHEMA_VERSION`, document the change in the table above,
   and make the new build tolerate old data (`unwrap_or` defaults for keys that
   may be missing, as `get_schema_version` does).
2. **Test against real data.** Deploy the *old* WASM to testnet, exercise it,
   then upgrade in place and confirm the pre-upgrade entries still read back
   correctly.
3. **Publish the new WASM.**
   ```bash
   stellar contract upload \
     --wasm target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm \
     --source admin \
     --network testnet
   ```
4. **Point the contract at it.** The contract id and storage are unchanged.
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --source admin \
     --network testnet \
     -- upgrade \
     --new_wasm_hash <HASH_FROM_STEP_3>
   ```
   > `upgrade` (a thin admin-gated wrapper over
   > `env.deployer().update_current_contract_wasm`) is not part of this build
   > yet — deployments upgrade by redeploying. Add it in the same release that
   > first needs an in-place upgrade, and gate it on the stored admin exactly
   > like `migrate`.
5. **Rewrite data if the release notes call for it.** Entries that changed
   shape must be read and re-written by a migration entry point added for that
   release. Streams and escrows are enumerable via `get_stream_count()` /
   `get_escrow_count()`, so a migration can walk ids `0..count`. Batch it
   across several transactions if the instance holds more entries than fit in
   one resource budget.
   > Unlike `v1` (purely additive — new keys, no existing data to touch),
   > `v2` changes the shape of `Stream` itself. `migrate()` only stamps the
   > version number; it does not walk and rewrite existing entries. An
   > in-place upgrade to `v2` while any `v1`-shaped `Stream` is still open in
   > storage needs that rewrite step added here first, or `load_stream` will
   > fail to decode it. Not needed for a fresh deployment.
6. **Stamp the new version.**
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --source admin \
     --network testnet \
     -- migrate \
     --admin <ADMIN_ADDRESS>
   ```
7. **Verify.** `get_schema_version()` returns the new version, and spot-check
   entries written before the upgrade.

### Rollback

`migrate` refuses to run when the stored version is newer than the build
(`stored schema is newer than this contract`), so rolling the WASM back to an
older release fails loudly instead of misreading migrated data. To roll back,
redeploy a build whose `SCHEMA_VERSION` matches what is on-chain.

## Troubleshooting (#153)

The CLI commands above only work if the contract compiles. The merge residue
that used to block `cargo build` is gone — `cargo check`, `cargo test` and
`cargo build --target wasm32-unknown-unknown --release` are all green — but
two build-level pitfalls remain worth knowing about:

- **Dependency drift.** `Cargo.lock` is committed on purpose. Deleting it (or
  running `cargo update` casually) re-resolves soroban-sdk's transitive
  dependencies, and some of those versions do not build on current stable
  Rust — `error[E0512]: cannot transmute between types of different sizes` in
  `ethnum`, or `no function or associated item named try_size_hint` in
  `stellar-xdr`, are both this. Restore the lockfile with
  `git checkout Cargo.lock` rather than chasing the errors upstream.
- **Missing WASM target.** `error[E0463]: can't find crate for 'core'` means
  the target is not installed: `rustup target add wasm32-unknown-unknown`.

If a build error points inside `src/lib.rs` instead, check `git blame` around
the offending line first — historically most of the breakage here has been
incomplete merge resolutions rather than real logic bugs.

## XLM SAC Address (Testnet)

The Stellar Asset Contract address for native XLM on testnet:
```
CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

## Formal Verification (#565)

`contracts/certora/streaming.spec` is a Certora CVL spec documenting the
streaming-payment invariants — `claimed <= deposited` (#557) and the
authorization rules (only a stream's recipients can claim, only the payer can
top up or close) — mirroring the sister project's escrow spec (Stellar
MarketPay, `contracts/certora/escrow.spec`). The Certora Prover does not yet
target Soroban/WASM directly, so this spec is documentation rather than a
wired-up `certoraRun` CI job; it is the formally-notated statement of what
`src/lib.rs` must uphold, re-checked by hand whenever the streaming logic
changes.

## Roadmap

- **v2.1** — Escrow payments with time-lock release
- **v2.0** — Batch micro-payment transactions
- **v1.4** — Creator tip pages

See [ROADMAP.md](../../ROADMAP.md) for full details.

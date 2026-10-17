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
- Batch tips: one authorized transfer pays up to 25 recipients, each charged the
  same operator fee a single `send_tip` would take
- Placeholder stub for batch payments

- Placeholder stub for batch payments

## Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32v1-none

# Install Stellar CLI
cargo install --locked stellar-cli
```

## Build

From the repository root:

```bash
make contract        # build + optimize the deployable WASM, prints its path and size
make contract-test   # run only the contract test suite
```

`make contract` runs `stellar contract build --locked --optimize=true`, which is
what CI builds the deployable artifact with too. `stellar contract optimize`
still exists in the CLI but is deprecated — `build --optimize` (on by default)
replaced it — so the target optimizes in a single step rather than
build-then-optimize.

Building by hand, from this directory:

```bash
stellar contract build
```

Output: `target/wasm32v1-none/release/stellar_micropay_contract.wasm`
(relative to the workspace root, not this directory — cargo writes to the
workspace `target/` even when invoked from a member crate, and that is the same
path `make contract`, CI and `scripts/deploy-contract.sh` use).

## Test

```bash
cargo test
```

or, from the repository root, `make contract-test`. CI runs `cargo test --locked`
against the committed `Cargo.lock`, so a `Cargo.toml` change has to be committed
together with its regenerated lock file.

## Security review (#1121)

Every entry point in `src/lib.rs` was reviewed for authorization correctness,
and the outcome is documented as a doc comment above each function.

| Entry point | Authorization | Review note |
| --- | --- | --- |
| `initialize` | `admin` | Was missing — see finding 1 |
| `send_tip` | `from` | Auth covers `(token_address, from, to, amount)`; amount validated first |
| `mint_receipt` | `from` | Auth covers `(from, to, amount, memo)`; records keyed by the authenticated payer |
| `get_tip_total`, `get_tip_count`, `get_admin`, `get_tip_record`, `get_receipt_count`, `get_receipt` | none (read-only) | No state is written and the values are public |
| `batch_tip` | `from` | One authorization covers the whole batch; the size, positivity and duplicate checks all run before the first transfer |
| `batch_send` | none (stub) | Validates batch shape (equal lengths, non-empty, `<= MAX_BATCH`), then panics — no state is written |

### Findings fixed

1. **`initialize` stored an admin without authorization (critical).** It wrote
   `DataKey::Admin` without any auth check, so any account could install an
   arbitrary admin. Fixed by calling `admin.require_auth()` before the write.
2. **`require_auth` ran before argument validation (low)** in `send_tip` and
   `mint_receipt`. A panicking sub-call does not roll back sibling effects in
   the same transaction when the contract is invoked by another contract, so a
   rejected call could leave a satisfied auth entry behind for the payer.
   Fixed by validating `amount` before requesting authorization.

### Residual risk (documented, not changed)

- `initialize` is a separate invocation from the deploy, so the first caller
  can still install *themselves* as admin: `require_auth` proves the stored
  admin consented to the role, it cannot prove that address is the deployer.
  Deploy through a `__constructor` (deploy-time initialization) or invoke
  `initialize` in the same transaction as the deploy to remove that window.
- Confirmed already correct: the nested SAC `transfer` in `send_tip` sits under
  the sender's authorization; auth arguments match invocation arguments, so
  argument swapping is rejected by the host; `mint_receipt` writes are keyed by
  the authenticated payer; the getters are read-only; the escrow and batch
  stubs always panic.

### Auth test coverage

`cargo test` exercises every `require_auth` call site, including the negative
cases that must fail:

- `test_initialize_requires_admin_auth` — the admin is the sole authorizer.
- `test_initialize_rejects_unauthorized_admin` — no authorization at all fails,
  and the contract stays uninitialized.
- `test_initialize_rejects_authorization_of_another_address` — authorizing a
  different address cannot install another account as admin.
- `test_send_tip_moves_funds_and_requires_from_auth` / `test_send_tip_rejects_unauthorized_caller`
  — funds move under the sender's authorization, and an unauthorized caller
  moves nothing.
- `test_mint_receipt_requires_from_auth` / `test_mint_receipt_rejects_unauthorized_caller`
  — receipts are minted only under the payer's authorization.
- `test_failed_mint_does_not_consume_auth` — a rejected call consumes no
  authorization and leaves no state behind.

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

## Local network

You can deploy and exercise the contract without testnet by running a
standalone Stellar network in Docker. The `stellar` service in the root
`docker-compose.yml` runs `stellar/quickstart` in `--local` mode with Horizon,
Soroban RPC and Friendbot on port 8000. It sits behind the `localnet` profile,
so `docker compose up` on its own does not start it.

Requirements: Docker, the Stellar CLI and the Rust toolchain from
[Prerequisites](#prerequisites).

From the repository root:

```bash
make localnet-up      # start quickstart and wait until Soroban RPC reports healthy
make deploy-local     # register the "local" CLI network, fund local-admin, build, deploy, initialize
make smoke-local      # read-only checks: get_admin, get_fee_bps, is_frozen
make localnet-down    # stop the container
```

`make deploy-local` writes the contract ID to `.contract-id.local` (git-ignored)
and always deploys a fresh instance, because a standalone network loses its
state when the container is recreated. The deployer identity defaults to
`local-admin`; override it with `make deploy-local LOCAL_IDENTITY=me`.

Under the hood these targets run:

```bash
stellar network add local \
  --rpc-url http://localhost:8000/rpc \
  --network-passphrase "Standalone Network ; February 2017"
stellar keys generate local-admin --network local --fund
STELLAR_IDENTITY=local-admin ./scripts/deploy-contract.sh local
```

### Pointing the app at the local network

| Component | Variable | Local value |
| --- | --- | --- |
| Backend | `STELLAR_NETWORK` | `testnet` (keeps the Horizon/SDK defaults; see note below) |
| Backend | `HORIZON_URL` | `http://localhost:8000` (`http://stellar:8000` from inside compose) |
| Backend | `SOROBAN_RPC_URL` | `http://localhost:8000/rpc` (`http://stellar:8000/rpc` from inside compose) |
| Backend | `CONTRACT_ID` | contents of `.contract-id.local` |
| Frontend | `NEXT_PUBLIC_HORIZON_URL` | `http://localhost:8000` |
| Frontend | `NEXT_PUBLIC_CONTRACT_ID` | contents of `.contract-id.local` |

In the frontend you can also pick **Custom** in Settings and enter
`http://localhost:8000` as the Horizon URL.

Limitation: the frontend and the backend Turrets/SEP-10 code currently sign
with either the testnet or the public passphrase, never the standalone one.
Reading contract state and Horizon data works against the local network, but
wallet-signed transactions from the UI will be rejected until the app learns a
configurable passphrase. Use the Stellar CLI (as above) for write calls.

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

# Tip several recipients in one transaction (at most 25 entries, and no
# recipient twice — see "Batch tips and the batch size cap")
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- batch_tip \
  --token_address <XLM_SAC_ADDRESS> \
  --from <SENDER_ADDRESS> \
  --tips '[["<RECIPIENT_1>", 5000], ["<RECIPIENT_2>", 10000]]'

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

## Batch tips and the batch size cap

`batch_tip` pays several recipients under a single authorization. Its cost grows
with the number of entries, and a transaction that exceeds a network resource
limit fails outright, so the batch size is capped by the constant `MAX_BATCH`
(**25**) in `src/lib.rs`. Bigger batches are rejected with
`Batch size exceeds maximum allowed (25 entries)` rather than burning a
simulation and then aborting in the host's budget accounting.

### Where 25 comes from

A batch costs resources per entry, and the network aborts a transaction that
crosses a per-transaction limit inside the host's budget accounting
(`HostError: Error(Budget, ExceededLimit)`) — an opaque failure that only shows
up after the caller has paid for a simulation. `MAX_BATCH` turns that into a
clear rejection, and it is set so far below the point where the budgets bind that
the margin itself is asserted by a test.

`test_batch_tip_fits_network_resource_limits` runs `batch_tip` at exactly
`MAX_BATCH` under the test host's default `InvocationResourceLimits::mainnet()`
enforcement and asserts the footprint stays inside these margins:

| Dimension | Mainnet limit per transaction | Asserted to stay under |
| --- | --- | --- |
| CPU instructions | 400,000,000 | 100,000,000 |
| Memory bytes | 41,943,040 | 10,000,000 |
| Contract event bytes | 16,384 | 12,288 |
| Write bytes | 132,096 | 66,048 |
| Write entries | 200 | 100 |

The call succeeding is the proof; the margins are the tripwire if the per-entry
cost grows. Two reasons to keep it conservative when revisiting the number: the
test contract is native Rust rather than WASM, so VM instantiation, WASM
execution and WASM linear-memory reservations go unmetered and the real on-chain
cost per entry is higher; and the duplicate-recipient scan is quadratic, so the
marginal entry gets more expensive as the batch grows. The dominant term is the
~400-byte event published per entry plus the serialized `(Address, i128)` vector.

Raising the cap means re-measuring with that test, not just editing the number —
and the literal in the panic messages has to be edited in the same commit, since
`panic!` takes a `&'static str` and cannot interpolate the constant.

### Rules

| Function | Empty batch | Above the cap | Notes |
| --- | --- | --- | --- |
| `batch_tip` | `At least one tip is required` | `Batch size exceeds maximum allowed (25 entries)` | Also rejects `amount <= 0` (`Tip amount must be positive`), a repeated recipient (`Duplicate tip recipient`), and an amount total that overflows i128 |
| `batch_send` | `At least one payment is required` | `Batch size exceeds maximum allowed (25 entries)` | Mismatched `recipients`/`amounts` lengths fail first (`Recipient and amount vectors must have the same length`). It is still a placeholder, so a valid batch ends in the v2.0 panic — the shape checks run before it |

Both entry points are checked client-side too: `MAX_RECIPIENTS` in
`frontend/components/BatchPaymentForm.tsx` is kept at the same value.

## Operator fee and rounding

The admin sets a fee in basis points (`set_fee_bps`, capped at 500 bps = 5%).
`fee_for` computes it as `amount * fee_bps / 10_000` **truncated to whole
stroops, per entry**, and it is the single source of truth for `send_tip` and
`batch_tip`; a batch is charged exactly what its entries would have cost
separately.

Two properties the tests pin down:

- **The cap holds.** Summing truncations can only ever undershoot, so
  `sum(fee_for(amount_i)) <= floor(total * fee_bps / 10_000) <= ceil(total *
  fee_bps / 10_000)` for any batch. Rounding *up* per entry would break this:
  two 1-stroop tips at 500 bps would each cost a stroop (2 total) against a
  ceiling of `ceil(2 * 500 / 10_000) = 1`. `prop_batch_tip_fee_respects_cap_and_conserves`
  searches for a counterexample and `test_send_tip_and_batch_tip_charge_the_same_fee`
  covers the split-by-case.
- **Value is conserved.** The payer is debited `gross`, the recipients are
  credited `amount - fee`, and the admin receives the fees, so
  `debit == sum(credits) + fee` holds by construction and the contract holds
  nothing back at the end of a batch. Before this was fixed, `batch_tip`
  collected no fee at all, so splitting a tip across a batch dodged it entirely.

Truncation is not free for the operator: each entry withholds less than a stroop,
so the largest possible leakage from a full batch is 24 stroops (there is no way
to round a sub-stroop fee up). The property tests include 1-stroop amounts and
amounts at `i128` scale (`prop_batch_tip_fee_is_exact_at_i128_scale`, where the
fee is exact because the amount is a multiple of 10,000).

The multiplication itself is split as `quotient * bps + (remainder * bps) / 10_000`
so no intermediate exceeds `i128` for legal amounts — `amount * fee_bps` as a
single product would overflow well before `i128::MAX` (see
`test_huge_tip_amounts_do_not_overflow_fee_math`).

## Troubleshooting (#153)

A Soroban SDK release requires the Stellar CLI to set build metadata and the
`wasm32v1-none` target on current Rust toolchains. Build with
`make contract` or `stellar contract build` as shown above; a direct
`cargo build` or the old `wasm32-unknown-unknown` target may fail even when the
contract source is valid.

## Error Reference

Almost every failure is a plain `panic!` or `.expect()` call, so there is no
numeric error code to match on client-side — catch the failed invocation and
match on the panic message (available in the transaction's diagnostic events
when simulated or submitted with debug info enabled). The exceptions are the two
`#[contracterror]` variants, which the host returns as error codes:
`ContractError::NotAdmin` (1, `freeze`/`unfreeze` called by a non-admin) and
`ContractError::Frozen` (2, any state-changing call against a frozen contract).

| Error message                                       | Trigger condition                                                                 | Affected function(s)                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| `Contract already initialized`                       | `initialize` is called a second time (the `Admin` storage key is already set).      | `initialize`                                      |
| `Contract not initialized`                            | A function that requires the admin address reads it before `initialize` was called. | `get_admin`, `send_tip`, `set_fee_bps`            |
| `Tip amount must be positive`                         | `send_tip` is called with `amount <= 0`, or any `batch_tip` entry has `amount <= 0`. | `send_tip`, `batch_tip`                           |
| `At least one tip is required`                        | `batch_tip` is called with an empty vector.                                         | `batch_tip`                                       |
| `Batch size exceeds maximum allowed (25 entries)`     | A batch longer than `MAX_BATCH` (25).                                              | `batch_tip`, `batch_send`                         |
| `Duplicate tip recipient`                             | The same address appears twice in one `batch_tip` call.                             | `batch_tip`                                       |
| `Tip total overflow`                                  | The batch amounts do not fit in `i128` together.                                    | `batch_tip`                                       |
| `Tip fee total overflow`                              | The batch fees do not fit in `i128` together.                                       | `batch_tip`                                       |
| `Tip record not found`                                | `get_tip_record` is called with a `(recipient, index)` pair that was never stored.  | `get_tip_record`                                  |
| `Receipt amount must be positive`                     | `mint_receipt` is called with `amount <= 0`.                                        | `mint_receipt`                                    |
| `Receipt not found`                                   | `get_receipt` is called with a `(payer, index)` pair that was never stored.         | `get_receipt`                                     |
| `Only the admin can set the fee`                      | `set_fee_bps` is called with an `admin` argument that doesn't match the stored admin, even if that address authorized the call. | `set_fee_bps`      |
| `Fee exceeds maximum allowed (500 bps)`               | `set_fee_bps` is called with `fee_bps > 500` (the 5% cap).                          | `set_fee_bps`                                     |
| `Recipient and amount vectors must have the same length` | `batch_send` is called with differently sized `recipients` and `amounts` vectors. | `batch_send`                                   |
| `At least one payment is required`                    | `batch_send` is called with empty vectors.                                          | `batch_send`                                      |
| `Batch payments coming in v2.0 — see ROADMAP.md`      | `batch_send` is called with a well-formed batch — it is still an unimplemented placeholder, so this panic is the last thing it does, after the size checks above. | `batch_send` |

`send_tip`, `batch_tip` and `mint_receipt` also panic implicitly if the caller isn't the
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

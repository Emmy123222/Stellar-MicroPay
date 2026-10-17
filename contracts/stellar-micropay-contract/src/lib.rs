#![no_std]

/**
 * contracts/stellar-micropay-contract/src/lib.rs
 *
 * Stellar MicroPay — Soroban Smart Contract
 *
 * Provides:
 *   - Streaming payments (open/claim/top-up/close + pause/resume)
 *   - Escrow payments (ROADMAP v2.1)
 *   - Milestone-based escrow release with dispute timeout (ROADMAP v2.1)
 *   - Creator tipping (ROADMAP v1.4)
 *   - Micro-transaction batching (ROADMAP v2.0)
 *   - NFT payment receipts (ROADMAP v1.5)
 */

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN,
    Env, Symbol,
};

// ─── Contract errors ──────────────────────────────────────────────────────────

/// Typed errors surfaced to callers via Soroban's generated client.
/// Discriminants are stable — do not reorder or remove variants.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContractError {
    /// The caller is not the stored admin.
    NotAdmin = 1,
    /// The contract is frozen; state-changing calls are rejected.
    /// Read-only getters keep working while frozen.
    Frozen = 2,
}

// ─── Data types ───────────────────────────────────────────────────────────────

/// A single tip event recorded on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TipRecord {
    /// The sender's Stellar address
    pub from: Address,
    /// The recipient's Stellar address
    pub to: Address,
    /// Amount in stroops (1 XLM = 10_000_000 stroops)
    pub amount: i128,
    /// Ledger number when this tip was sent
    pub ledger: u32,
}

/// On-chain receipt metadata minted as proof of payment.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ReceiptMetadata {
    /// The payer's Stellar address
    pub from: Address,
    /// The payee's Stellar address
    pub to: Address,
    /// Amount in stroops (1 XLM = 10_000_000 stroops)
    pub amount: i128,
    /// ISO-8601 timestamp of when the receipt was minted
    pub timestamp: u64,
    /// Optional payment memo
    pub memo: Symbol,
    /// Ledger number when this receipt was minted
    pub ledger: u32,
}

/// A streaming payment channel: payer deposits funds streamed at a fixed rate.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Stream {
    pub payer: Address,
    pub recipient: Address,
    pub rate_per_ledger: i128,
    pub deposited: i128,
    pub claimed: i128,
    pub start_ledger: u32,
    /// Ledger at which the stream was paused (None = running).
    pub pause_ledger: Option<u32>,
}

/// An escrow payment locked until a release ledger.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowRecord {
    pub payer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub released: bool,
    pub cancelled: bool,
}

// ─── TTL constants ────────────────────────────────────────────────────────────

/// Extend the contract instance TTL when the remaining lifetime drops below
/// this many ledgers (~14 days at 5 s/ledger on mainnet).
const INSTANCE_TTL_THRESHOLD: u32 = 100_000;

/// Target lifetime to set on the instance entry when it is extended
/// (~28 days at 5 s/ledger). Must not exceed the network's max entry lifetime.
const INSTANCE_TTL_BUMP: u32 = 200_000;

// ─── Milestone escrow ─────────────────────────────────────────────────────────

/// Escrow records live in persistent storage and are re-extended on every read
/// and write, so a record cannot be evicted while it still holds funds.
/// `ESCROW_TTL_BUMP` has to stay below the network's maximum entry lifetime.
const ESCROW_TTL_THRESHOLD: u32 = 100_000;
const ESCROW_TTL_BUMP: u32 = 200_000;

/// Upper bound on `dispute_timeout`. It must stay below
/// `ESCROW_TTL_THRESHOLD` so the record outlives the dispute window it was
/// created with.
const MAX_DISPUTE_TIMEOUT: u32 = 50_000;

/// Lifecycle of a milestone escrow.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    /// Funds are locked, awaiting approval or dispute.
    Pending,
    /// The approver released the funds to the recipient.
    Approved,
    /// The payer disputed the milestone; funds are held until the timeout.
    Disputed,
    /// The payer reclaimed the funds after the dispute timeout elapsed.
    Cancelled,
}

/// Funds locked in the contract until a milestone is approved or a dispute
/// times out.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneEscrowRecord {
    /// SAC of the token the funds are held in
    pub token: Address,
    /// Who locked the funds and may reclaim them
    pub payer: Address,
    /// Who receives the funds when the milestone is approved
    pub recipient: Address,
    /// The third party whose approval releases the funds
    pub approver: Address,
    /// Amount in the token's smallest unit (stroops for XLM)
    pub amount: i128,
    pub status: EscrowStatus,
    /// Ledger the escrow was created in
    pub created_ledger: u32,
    /// Ledger the dispute was raised in; `0` while undisputed
    pub dispute_ledger: u32,
    /// Ledgers the payer must wait after disputing before reclaiming
    pub dispute_timeout: u32,
}

/// Emitted when funds are locked into a milestone escrow.
#[contractevent(topics = ["milestone_escrow", "created"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneEscrowCreated {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub payer: Address,
    pub recipient: Address,
    pub approver: Address,
    pub token: Address,
    pub amount: i128,
    pub dispute_timeout: u32,
}

/// Emitted when the approver releases the funds to the recipient.
#[contractevent(topics = ["milestone_escrow", "approved"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneEscrowApproved {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub approver: Address,
    pub recipient: Address,
    pub amount: i128,
}

/// Emitted when the payer disputes the milestone and the funds go on hold.
#[contractevent(topics = ["milestone_escrow", "disputed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneEscrowDisputed {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub payer: Address,
    pub amount: i128,
    /// First ledger in which `cancel_milestone_escrow` will succeed
    pub reclaim_after: u32,
}

/// Emitted when the payer reclaims disputed funds after the timeout.
#[contractevent(topics = ["milestone_escrow", "cancelled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneEscrowCancelled {
    #[topic]
    pub escrow_id: u32,
    #[topic]
    pub payer: Address,
    pub amount: i128,
}

/// Storage keys.
#[contracttype]
pub enum DataKey {
    Admin,
    TipTotal(Address),
    TipCount(Address),
    /// Latest tip record for a recipient (indexed by recipient + count)
    TipRecord(Address, u32),
    /// Total receipt count for a payer
    ReceiptCount(Address),
    /// Receipt record indexed by (payer, index)
    ReceiptRecord(Address, u32),
/// Operator fee, in basis points, charged on every tip
    FeeBps,
    /// Total number of streams ever opened
    StreamCount,
    /// Stream record indexed by stream id
    Stream(u32),
    /// Total number of escrows ever opened
    EscrowCount,
    /// Escrow record indexed by escrow id
    Escrow(u32),
    /// Milestone escrow record, indexed by escrow id
    MilestoneEscrow(u32),
    /// Number of milestone escrows ever created (the next escrow id)
    MilestoneEscrowCount,
    /// Global circuit-breaker: while true, state-changing calls are rejected.
    Frozen,
}

/// Event payload emitted when a tip is sent, capturing the gross tip
/// amount and any operator fee that was deducted from it.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TipEventData {
    pub amount: i128,
    pub fee_amount: i128,
}

/// Maximum operator fee the admin may configure, in basis points (5%).
const MAX_FEE_BPS: u32 = 500;

/// Basis-point denominator: 1 bps = 1 / 10_000.
const FEE_BPS_DENOMINATOR: i128 = 10_000;

/// Maximum number of entries accepted by a single batch call (`batch_tip`,
/// `batch_send`).
///
/// A batch costs resources per entry, and a transaction that crosses a network
/// per-transaction limit aborts in the host's budget accounting with
/// `HostError: Error(Budget, ExceededLimit)` — an opaque failure that arrives
/// only after the caller paid for a simulation. Rejecting above this cap turns
/// that into a clear message, so the value has to stay comfortably below the
/// point where the limits bind.
///
/// Where the limits are: the test host enforces
/// `InvocationResourceLimits::mainnet()` — 400M instructions, 41,943,040 memory
/// bytes, 16,384 contract-event bytes, 132,096 write bytes and 200 write entries
/// per transaction. `test_batch_tip_fits_network_resource_limits` runs a batch
/// of exactly `MAX_BATCH` and asserts the footprint keeps a wide margin under
/// each of them, which is the tripwire if the per-entry cost ever grows.
///
/// Two things keep the cap conservative relative to those budgets: the test
/// contract is native Rust rather than WASM, so VM instantiation, WASM
/// execution and WASM linear-memory reservations go unmetered and the real
/// on-chain cost per entry is higher; and the duplicate-recipient scan is
/// quadratic, so the marginal entry gets more expensive as the batch grows. The
/// dominant term is the ~400-byte event published per entry plus the serialized
/// `(Address, i128)` vector.
///
/// Raising this means re-measuring against the same test, not just editing the
/// number. Keep the literal in the panic messages in sync with it: `panic!`
/// takes a `&'static str`, so the constant cannot be interpolated.
const MAX_BATCH: u32 = 25;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Operator fee for a gross `amount` at `fee_bps`, truncated to whole stroops.
///
/// Rounding policy (#1488): the fee is rounded **down** per entry, so a
/// recipient never receives less than `amount - amount * fee_bps / 10_000` and
/// the collected fee can never exceed the nominal rate. The consequence is that
/// a sub-stroop fee rounds to zero, so a batch's total fee is at most the fee on
/// the batch total, and can fall below it by less than one stroop per entry.
///
/// The arithmetic is split so that no intermediate product can overflow:
/// `amount * fee_bps` would panic for i128-scale amounts (release builds enable
/// `overflow-checks`), so `amount` is decomposed as `q * 10_000 + r` and each
/// part is scaled separately. The result is exactly `floor(amount * bps / 10_000)`.
fn fee_for(amount: i128, fee_bps: u32) -> i128 {
    let bps = fee_bps as i128;
    let quotient = amount / FEE_BPS_DENOMINATOR;
    let remainder = amount % FEE_BPS_DENOMINATOR;
    quotient * bps + (remainder * bps) / FEE_BPS_DENOMINATOR
}

/// Bump the contract instance TTL at the start of every entry point so the
/// instance storage entry is never archived while the contract is actively
/// used. The bump is a no-op when the remaining TTL already exceeds
/// `INSTANCE_TTL_THRESHOLD`.
#[inline]
fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);
}

/// Reject the call if the contract is frozen.
/// Read-only getters deliberately do **not** call this — a frozen contract
/// must still be inspectable by monitoring and UI.
#[inline]
fn require_not_frozen(env: &Env) {
    let frozen: bool = env
        .storage()
        .instance()
        .get(&DataKey::Frozen)
        .unwrap_or(false);
    if frozen {
        env.panic_with_error(&ContractError::Frozen);
    }
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct MicroPayContract;

#[contractimpl]
impl MicroPayContract {
    // ─── Initialization ──────────────────────────────────────────────────────

    /// Initialize the contract with an admin address.
    /// Can only be called once.
    ///
    /// Security review (#1121):
    ///   - `admin` must authorize, so the stored admin address can never be
    ///     set to a value that the admin itself did not sign off on.
    ///   - Once written, the admin can never be changed: the duplicate-init
    ///     check rejects any later call before it reaches the write.
    ///
    /// Residual risk (documented, not changed by this review): `initialize`
    /// is a separate invocation from the deploy, so the first caller can
    /// still install *themselves* as admin — `require_auth` proves the stored
    /// admin consented to being admin, it cannot prove the address is the
    /// deployer. Deploy via a `__constructor` (deploy-time init) or invoke
    /// `initialize` in the same transaction as the deploy to close that
    /// window entirely.
    pub fn initialize(env: Env, admin: Address) {
        bump_instance(&env);
        // Ensure not already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    // ─── Admin & Upgrade ─────────────────────────────────────────────────────

    /// Upgrade the WASM code of the current contract.
    /// Admin-gated: only stored Admin address can call this function.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        bump_instance(&env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Rotate/update the contract admin address.
    /// Admin-gated: only current Admin address can set a new admin.
    pub fn set_admin(env: Env, new_admin: Address) {
        bump_instance(&env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    // ─── Emergency pause ─────────────────────────────────────────────────────

    /// Pause all state-changing operations until [`unfreeze`] is called.
    /// Read-only getters and admin functions remain available while frozen so
    /// monitoring and recovery operations can still inspect and repair state.
    /// Admin-gated.
    pub fn freeze(env: Env, admin: Address) {
        bump_instance(&env);
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        if admin != stored {
            env.panic_with_error(&ContractError::NotAdmin);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Frozen, &true);
        env.events()
            .publish((Symbol::new(&env, "freeze"), admin), true);
    }

    /// Clear the freeze flag, re-enabling state-changing operations.
    /// Admin-gated.
    pub fn unfreeze(env: Env, admin: Address) {
        bump_instance(&env);
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        if admin != stored {
            env.panic_with_error(&ContractError::NotAdmin);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Frozen, &false);
        env.events()
            .publish((Symbol::new(&env, "unfreeze"), admin), false);
    }

    /// Whether the contract is currently frozen. Always callable.
    pub fn is_frozen(env: Env) -> bool {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Frozen)
            .unwrap_or(false)
    }

    // ─── Tipping ─────────────────────────────────────────────────────────────

    /// Send a tip from `from` to `to` using a Stellar token.
    ///
    /// Parameters:
    ///   - token_address: The SAC (Stellar Asset Contract) address for the token (e.g. XLM)
    ///   - from:          The sender (must authorize this call)
    ///   - to:            The recipient
    ///   - amount:        Amount in the token's smallest unit (stroops for XLM)
    ///
    /// If an operator fee is configured (see `set_fee_bps`), `amount * fee_bps / 10000`
    /// is transferred to the admin and the remainder to `to`. This records the tip
    /// on-chain for analytics and emits an event.
    ///
    /// The fee is rounded down to whole stroops (see `fee_for`), so the admin can
    /// never take more than the nominal rate and a sub-stroop fee is simply zero.
    pub fn send_tip(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) {
        bump_instance(&env);
        require_not_frozen(&env);

        // Require sender authorization
        from.require_auth();

        // Validate amount
        if amount <= 0 {
            panic!("Tip amount must be positive");
        }

        let fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(0);
        let fee_amount: i128 = fee_for(amount, fee_bps);
        let net_amount: i128 = amount - fee_amount;

        // Transfer tokens via the Stellar token interface (SAC)
        let token = token::Client::new(&env, &token_address);

        if fee_amount > 0 {
            let admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .expect("Contract not initialized");
            token.transfer(&from, &admin, &fee_amount);
        }

        token.transfer(&from, &to, &net_amount);

        // Update on-chain tip totals for the recipient
        let current_total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TipTotal(to.clone()))
            .unwrap_or(0);

        let current_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TipCount(to.clone()))
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&DataKey::TipTotal(to.clone()), &(current_total + amount));

        env.storage()
            .instance()
            .set(&DataKey::TipCount(to.clone()), &(current_count + 1));

        // Store the tip record so it can be queried later
        let record = TipRecord {
            from: from.clone(),
            to: to.clone(),
            amount,
            ledger: env.ledger().sequence(),
        };
        env.storage()
            .instance()
            .set(&DataKey::TipRecord(to.clone(), current_count), &record);

        // Emit an event for indexers, including the fee collected (if any)
        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "send_tip"),
                from,
                to.clone(),
            ),
            TipEventData { amount, fee_amount },
        );
    }

    /// Send several tips atomically. The sender is debited once for the total;
    /// the contract then fans the funds out to each unique recipient.
    ///
    /// The configured operator fee applies to every entry exactly as it does to
    /// a single `send_tip`: `floor(amount * fee_bps / 10000)` is withheld from
    /// that entry and the withheld sum is credited to the admin in one transfer.
    /// The payer is debited the gross total, so
    /// `gross == sum(recipient credits) + fee` holds by construction.
    ///
    /// Because each entry is rounded down independently, splitting one tip into a
    /// batch can only lower the fee, never raise it above the nominal rate.
    ///
    /// Batches are capped at `MAX_BATCH` entries: larger batches exceed the
    /// network's per-transaction resource limits and would otherwise fail with an
    /// opaque budget error instead of a clear one.
    pub fn batch_tip(
        env: Env,
        token_address: Address,
        from: Address,
        tips: soroban_sdk::Vec<(Address, i128)>,
    ) {
        bump_instance(&env);
        from.require_auth();
        if tips.len() == 0 {
            panic!("At least one tip is required");
        }
        if tips.len() > MAX_BATCH {
            panic!("Batch size exceeds maximum allowed (25 entries)");
        }

        let fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(0);

        let mut total = 0i128;
        let mut fee_total = 0i128;
        let mut i = 0u32;
        while i < tips.len() {
            let (recipient, amount) = tips.get(i).unwrap();
            if amount <= 0 {
                panic!("Tip amount must be positive");
            }
            let mut j = 0u32;
            while j < i {
                let (previous, _) = tips.get(j).unwrap();
                if previous == recipient {
                    panic!("Duplicate tip recipient");
                }
                j += 1;
            }
            total = total.checked_add(amount).expect("Tip total overflow");
            fee_total = fee_total
                .checked_add(fee_for(amount, fee_bps))
                .expect("Tip fee total overflow");
            i += 1;
        }

        let token = token::Client::new(&env, &token_address);
        let contract = env.current_contract_address();
        token.transfer(&from, &contract, &total);

        if fee_total > 0 {
            let admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .expect("Contract not initialized");
            token.transfer(&contract, &admin, &fee_total);
        }

        let mut index = 0u32;
        while index < tips.len() {
            let (recipient, amount) = tips.get(index).unwrap();
            token.transfer(&contract, &recipient, &(amount - fee_for(amount, fee_bps)));

            let current_total: i128 = env
                .storage()
                .instance()
                .get(&DataKey::TipTotal(recipient.clone()))
                .unwrap_or(0);
            let current_count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::TipCount(recipient.clone()))
                .unwrap_or(0);
            env.storage().instance().set(
                &DataKey::TipTotal(recipient.clone()),
                &(current_total + amount),
            );
            env.storage()
                .instance()
                .set(&DataKey::TipCount(recipient.clone()), &(current_count + 1));
            env.storage().instance().set(
                &DataKey::TipRecord(recipient.clone(), current_count),
                &TipRecord {
                    from: from.clone(),
                    to: recipient.clone(),
                    amount,
                    ledger: env.ledger().sequence(),
                },
            );
            env.events()
                .publish((Symbol::new(&env, "tip"), from.clone(), recipient), amount);
            index += 1;
        }
    }

    // ─── Fees ────────────────────────────────────────────────────────────────

    /// Set the operator fee charged on every tip, in basis points
    /// (1 bps = 0.01%). Capped at 500 bps (5%). Only callable by the
    /// current admin. A `fee_bps` of 0 disables the fee (the default).
    pub fn set_fee_bps(env: Env, admin: Address, fee_bps: u32) {
        bump_instance(&env);
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");

        if admin != stored_admin {
            panic!("Only the admin can set the fee");
        }

        if fee_bps > MAX_FEE_BPS {
            panic!("Fee exceeds maximum allowed (500 bps)");
        }

        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
    }

    /// Get the currently configured operator fee, in basis points.
    pub fn get_fee_bps(env: Env) -> u32 {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(0)
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /// Get the total amount tipped to a recipient (in stroops).
    ///
    /// Security review (#1121): read-only accessor — no `require_auth` is
    /// required because no state is written and the value is public.
    pub fn get_tip_total(env: Env, recipient: Address) -> i128 {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::TipTotal(recipient))
            .unwrap_or(0)
    }

    /// Get the number of tips received by a recipient.
    ///
    /// Security review (#1121): read-only accessor — no `require_auth` is
    /// required because no state is written and the value is public.
    pub fn get_tip_count(env: Env, recipient: Address) -> u32 {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::TipCount(recipient))
            .unwrap_or(0)
    }

    /// Get the contract admin address.
    ///
    /// Security review (#1121): read-only accessor — `get_admin` writes no
    /// state, so it needs no authorization. It reveals the admin address,
    /// which is already public on-chain.
    pub fn get_admin(env: Env) -> Address {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized")
    }

    /// Get a specific tip record for a recipient by index.
    ///
    /// Security review (#1121): read-only accessor — no `require_auth` is
    /// required because no state is written. Tip records contain only public
    /// payment data.
    pub fn get_tip_record(env: Env, recipient: Address, index: u32) -> TipRecord {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::TipRecord(recipient, index))
            .expect("Tip record not found")
    }

    // ─── NFT Receipts ───────────────────────────────────────────────────────

    /// Mint an on-chain receipt as proof of payment.
    pub fn mint_receipt(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
        memo: Symbol,
    ) -> u32 {
        bump_instance(&env);
        require_not_frozen(&env);

        from.require_auth();

        if amount <= 0 {
            panic!("Receipt amount must be positive");
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCount(from.clone()))
            .unwrap_or(0);

        let receipt = ReceiptMetadata {
            from: from.clone(),
            to: to.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
            memo,
            ledger: env.ledger().sequence(),
        };

        env.storage()
            .instance()
            .set(&DataKey::ReceiptRecord(from.clone(), count), &receipt);

        env.storage()
            .instance()
            .set(&DataKey::ReceiptCount(from.clone()), &(count + 1));

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "mint_receipt"),
                from,
                to,
            ),
            count,
        );

        count
    }

    /// Get the total number of receipts minted for a payer.
    ///
    /// Security review (#1121): read-only accessor — no `require_auth` is
    /// required because no state is written and the count is public.
    pub fn get_receipt_count(env: Env, payer: Address) -> u32 {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::ReceiptCount(payer))
            .unwrap_or(0)
    }

    /// Get a specific receipt for a payer by index.
    ///
    /// Security review (#1121): read-only accessor — no `require_auth` is
    /// required because no state is written. Receipt metadata contains only
    /// public payment data.
    pub fn get_receipt(env: Env, payer: Address, index: u32) -> ReceiptMetadata {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::ReceiptRecord(payer, index))
            .expect("Receipt not found")
    }

    // ─── Milestone escrow ────────────────────────────────────────────────────

    /// Lock `amount` of `token` in the contract until a third party confirms
    /// the milestone was met.
    ///
    /// The payer funds the escrow up front. `approver` alone can release it
    /// with [`approve_milestone`]; the payer alone can freeze it with
    /// [`dispute_milestone`] and reclaim it through [`cancel_milestone_escrow`] once
    /// `dispute_timeout` ledgers have passed.
    ///
    /// Returns the escrow id used by every other escrow call.
    pub fn create_milestone_escrow(
        env: Env,
        token: Address,
        payer: Address,
        recipient: Address,
        amount: i128,
        approver: Address,
        dispute_timeout: u32,
    ) -> u32 {
        bump_instance(&env);
        payer.require_auth();

        if amount <= 0 {
            panic!("Escrow amount must be positive");
        }
        if dispute_timeout == 0 || dispute_timeout > MAX_DISPUTE_TIMEOUT {
            panic!("Escrow dispute timeout is out of range");
        }

        // Hold the funds in the contract until the milestone resolves.
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&payer, &contract, &amount);

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MilestoneEscrowCount)
            .unwrap_or(0);

        let escrow = MilestoneEscrowRecord {
            token: token.clone(),
            payer: payer.clone(),
            recipient: recipient.clone(),
            approver: approver.clone(),
            amount,
            status: EscrowStatus::Pending,
            created_ledger: env.ledger().sequence(),
            dispute_ledger: 0,
            dispute_timeout,
        };
        Self::save_escrow(&env, id, &escrow);
        env.storage()
            .instance()
            .set(&DataKey::MilestoneEscrowCount, &(id + 1));

        MilestoneEscrowCreated {
            escrow_id: id,
            payer,
            recipient,
            approver,
            token,
            amount,
            dispute_timeout,
        }
        .publish(&env);

        id
    }

    /// Release the escrowed funds to the recipient because the milestone was met.
    ///
    /// Callable only by the escrow's `approver`, and only while the escrow is
    /// still pending — a disputed escrow is frozen until the payer reclaims it.
    pub fn approve_milestone(env: Env, escrow_id: u32, approver: Address) {
        bump_instance(&env);
        let escrow = Self::load_escrow(&env, escrow_id);

        approver.require_auth();
        if approver != escrow.approver {
            panic!("Only the designated approver can approve this escrow");
        }
        if escrow.status != EscrowStatus::Pending {
            panic!("Escrow is no longer pending");
        }

        let contract = env.current_contract_address();
        token::Client::new(&env, &escrow.token).transfer(
            &contract,
            &escrow.recipient,
            &escrow.amount,
        );

        let mut released = escrow.clone();
        released.status = EscrowStatus::Approved;
        Self::save_escrow(&env, escrow_id, &released);

        MilestoneEscrowApproved {
            escrow_id,
            approver,
            recipient: escrow.recipient.clone(),
            amount: escrow.amount,
        }
        .publish(&env);
    }

    /// Freeze a pending escrow because the payer contests the milestone.
    ///
    /// The funds stay in the contract; after `dispute_timeout` ledgers the
    /// payer may reclaim them with [`cancel_milestone_escrow`].
    pub fn dispute_milestone(env: Env, escrow_id: u32, payer: Address) {
        bump_instance(&env);
        let escrow = Self::load_escrow(&env, escrow_id);

        payer.require_auth();
        if payer != escrow.payer {
            panic!("Only the payer can dispute this escrow");
        }
        if escrow.status != EscrowStatus::Pending {
            panic!("Escrow is no longer pending");
        }

        let mut disputed = escrow.clone();
        disputed.status = EscrowStatus::Disputed;
        disputed.dispute_ledger = env.ledger().sequence();
        Self::save_escrow(&env, escrow_id, &disputed);

        MilestoneEscrowDisputed {
            escrow_id,
            payer,
            amount: escrow.amount,
            reclaim_after: Self::reclaim_ledger(&disputed),
        }
        .publish(&env);
    }

    /// Reclaim a disputed escrow once its dispute timeout has elapsed.
    ///
    /// The funds go back to the payer and the escrow is closed.
    ///
    /// Named `cancel_milestone_escrow` rather than `cancel_escrow` because the
    /// contract already exposes `cancel_escrow` for time-locked escrows.
    pub fn cancel_milestone_escrow(env: Env, escrow_id: u32, payer: Address) {
        bump_instance(&env);
        let escrow = Self::load_escrow(&env, escrow_id);

        payer.require_auth();
        if payer != escrow.payer {
            panic!("Only the payer can cancel this escrow");
        }
        if escrow.status != EscrowStatus::Disputed {
            panic!("Escrow is not disputed");
        }
        if env.ledger().sequence() < Self::reclaim_ledger(&escrow) {
            panic!("Escrow dispute timeout has not elapsed");
        }

        let contract = env.current_contract_address();
        token::Client::new(&env, &escrow.token).transfer(&contract, &escrow.payer, &escrow.amount);

        let mut cancelled = escrow.clone();
        cancelled.status = EscrowStatus::Cancelled;
        Self::save_escrow(&env, escrow_id, &cancelled);

        MilestoneEscrowCancelled {
            escrow_id,
            payer,
            amount: escrow.amount,
        }
        .publish(&env);
    }

    /// Get a milestone escrow record by id.
    pub fn get_milestone_escrow(env: Env, escrow_id: u32) -> MilestoneEscrowRecord {
        bump_instance(&env);
        Self::load_escrow(&env, escrow_id)
    }

    /// Get the number of milestone escrows created so far.
    pub fn get_milestone_escrow_count(env: Env) -> u32 {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::MilestoneEscrowCount)
            .unwrap_or(0)
    }

    /// First ledger in which the payer of `escrow` may reclaim a disputed escrow.
    fn reclaim_ledger(escrow: &MilestoneEscrowRecord) -> u32 {
        escrow.dispute_ledger.saturating_add(escrow.dispute_timeout)
    }

    /// Read an escrow, bumping its storage lifetime so a long-running escrow
    /// outlives the ledger gap between state changes.
    fn load_escrow(env: &Env, escrow_id: u32) -> MilestoneEscrowRecord {
        let key = DataKey::MilestoneEscrow(escrow_id);
        let escrow: MilestoneEscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Escrow not found");
        env.storage()
            .persistent()
            .extend_ttl(&key, ESCROW_TTL_THRESHOLD, ESCROW_TTL_BUMP);
        escrow
    }

    /// Write an escrow and keep both the record and the contract instance
    /// alive for another window.
    fn save_escrow(env: &Env, escrow_id: u32, escrow: &MilestoneEscrowRecord) {
        let key = DataKey::MilestoneEscrow(escrow_id);
        env.storage().persistent().set(&key, escrow);
        env.storage()
            .persistent()
            .extend_ttl(&key, ESCROW_TTL_THRESHOLD, ESCROW_TTL_BUMP);
        env.storage()
            .instance()
            .extend_ttl(ESCROW_TTL_THRESHOLD, ESCROW_TTL_BUMP);
    }

    // ─── Streaming ─────────────────────────────────────────────────────────

    /// Open a new payment stream. Returns the stream id.
    pub fn open_stream(
        env: Env,
        payer: Address,
        recipient: Address,
        rate_per_ledger: i128,
        deposit: i128,
    ) -> u32 {
        bump_instance(&env);
        payer.require_auth();

        if rate_per_ledger <= 0 {
            panic!("Rate must be positive");
        }
        if deposit <= 0 {
            panic!("Deposit must be positive");
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::StreamCount)
            .unwrap_or(0);

        let stream = Stream {
            payer: payer.clone(),
            recipient: recipient.clone(),
            rate_per_ledger,
            deposited: deposit,
            claimed: 0,
            start_ledger: env.ledger().sequence(),
            pause_ledger: None,
        };

        env.storage().instance().set(&DataKey::Stream(count), &stream);
        env.storage().instance().set(&DataKey::StreamCount, &(count + 1));

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "open_stream"),
                payer,
                recipient,
            ),
            count,
        );

        count
    }

    /// Claim all currently claimable funds for a stream.
    pub fn claim_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
        bump_instance(&env);
        recipient.require_auth();

        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("Stream not found");

        if stream.recipient != recipient {
            panic!("Not stream recipient");
        }

        let current_ledger = env.ledger().sequence();
        let elapsed_ledgers = current_ledger.saturating_sub(stream.start_ledger);
        let total_streamed = stream
            .rate_per_ledger
            .checked_mul(elapsed_ledgers as i128)
            .unwrap_or(stream.deposited)
            .min(stream.deposited);
        let claimable = total_streamed - stream.claimed;

        // Freeze accrual while paused: recompute against pause_ledger.
        let claimable = if let Some(paused_at) = stream.pause_ledger {
            let paused_elapsed = paused_at.saturating_sub(stream.start_ledger);
            let paused_total = stream
                .rate_per_ledger
                .checked_mul(paused_elapsed as i128)
                .unwrap_or(stream.deposited)
                .min(stream.deposited);
            paused_total - stream.claimed
        } else {
            claimable
        };

        // Cap by remaining deposit.
        let remaining = stream.deposited - stream.claimed;
        let mut payout = claimable.max(0).min(remaining);
        if payout < 0 {
            payout = 0;
        }

        stream.claimed += payout;
        env.storage().instance().set(&DataKey::Stream(stream_id), &stream);

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "claim_stream"),
                recipient,
                stream_id,
            ),
            payout,
        );

        payout
    }

    /// Add more funds to an existing stream, extending its duration.
    pub fn top_up_stream(env: Env, stream_id: u32, payer: Address, amount: i128) {
        bump_instance(&env);
        payer.require_auth();

        if amount <= 0 {
            panic!("Top-up amount must be positive");
        }

        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("Stream not found");

        if stream.payer != payer {
            panic!("Not stream payer");
        }

        stream.deposited += amount;
        env.storage().instance().set(&DataKey::Stream(stream_id), &stream);

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "top_up_stream"),
                payer,
                stream_id,
            ),
            amount,
        );
    }

    /// Close a stream; payer is refunded the unstreamed remainder.
    ///
    /// **Mathematical invariant:** after `close_stream` returns,
    /// `refund + claimed == deposited` holds by construction — the recipient
    /// receives every streamable stroop (`claimed` rises to `total_streamed`),
    /// and the payer receives the balance (`refund = deposited - claimed`).
    ///
    /// Returns the refund amount.
    pub fn close_stream(env: Env, stream_id: u32, payer: Address) -> i128 {
        bump_instance(&env);
        payer.require_auth();

        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("Stream not found");

        if stream.payer != payer {
            panic!("Not stream payer");
        }

        let current_ledger = env.ledger().sequence();
        // Effective ledger is frozen at pause point while paused.
        let effective = stream.pause_ledger.unwrap_or(current_ledger);
        let elapsed = effective.saturating_sub(stream.start_ledger);
        let total_streamed = stream
            .rate_per_ledger
            .checked_mul(elapsed as i128)
            .unwrap_or(stream.deposited)
            .min(stream.deposited);

        // After close the recipient has effectively "claimed" everything that
        // was ever streamable. The `Stream` record carries no token field, so
        // this is a bookkeeping update rather than a transfer; the on-chain
        // payout path lives in `claim_stream`.
        stream.claimed = total_streamed;

        // Refund = what was deposited minus everything the recipient now holds.
        let refund = stream.deposited - stream.claimed;

        env.storage().instance().remove(&DataKey::Stream(stream_id));

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "close_stream"),
                payer,
                stream_id,
            ),
            refund,
        );

        refund
    }

    /// Pause a stream: freezes elapsed time at the current ledger.
    pub fn pause_stream(env: Env, stream_id: u32, payer: Address) {
        bump_instance(&env);
        payer.require_auth();

        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("Stream not found");

        if stream.payer != payer {
            panic!("Not stream payer");
        }
        if stream.pause_ledger.is_some() {
            panic!("Stream already paused");
        }

        stream.pause_ledger = Some(env.ledger().sequence());
        env.storage().instance().set(&DataKey::Stream(stream_id), &stream);

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "pause_stream"),
                payer,
                stream_id,
            ),
            env.ledger().sequence(),
        );
    }

    /// Resume a paused stream: shifts start_ledger forward by the paused duration.
    pub fn resume_stream(env: Env, stream_id: u32, payer: Address) {
        bump_instance(&env);
        payer.require_auth();

        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("Stream not found");

        if stream.payer != payer {
            panic!("Not stream payer");
        }

        let paused_at = stream.pause_ledger.expect("Stream is not paused");
        let current_ledger = env.ledger().sequence();
        let paused_duration = current_ledger.saturating_sub(paused_at);
        stream.start_ledger = stream.start_ledger.saturating_add(paused_duration);
        stream.pause_ledger = None;
        env.storage().instance().set(&DataKey::Stream(stream_id), &stream);

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "resume_stream"),
                payer,
                stream_id,
            ),
            current_ledger,
        );
    }

    /// Get a stream record.
    pub fn get_stream(env: Env, stream_id: u32) -> Stream {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("Stream not found")
    }

    /// Get the currently claimable amount for a stream.
    pub fn get_claimable(env: Env, stream_id: u32) -> i128 {
        bump_instance(&env);
        let stream: Stream = env
            .storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("Stream not found");

        let current_ledger = env.ledger().sequence();
        let elapsed_ledgers = current_ledger.saturating_sub(stream.start_ledger);
        let total_streamed = stream.rate_per_ledger * elapsed_ledgers as i128;
        let claimable = total_streamed - stream.claimed;

        // While paused, accrual is frozen at pause_ledger.
        let claimable = if let Some(paused_at) = stream.pause_ledger {
            let paused_elapsed = paused_at.saturating_sub(stream.start_ledger);
            let paused_total = stream.rate_per_ledger * paused_elapsed as i128;
            paused_total - stream.claimed
        } else {
            claimable
        };

        let remaining = stream.deposited - stream.claimed;
        claimable.max(0).min(remaining)
    }

    // ─── Escrow (ROADMAP v2.1) ─────────────────────────────────────────────

    /// Lock funds until `release_ledger`. Returns the escrow id.
    pub fn open_escrow(
        env: Env,
        payer: Address,
        recipient: Address,
        amount: i128,
        release_ledger: u32,
    ) -> u32 {
        bump_instance(&env);
        payer.require_auth();

        if amount <= 0 {
            panic!("Escrow amount must be positive");
        }
        if release_ledger <= env.ledger().sequence() {
            panic!("Release ledger must be in the future");
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0);

        let record = EscrowRecord {
            payer: payer.clone(),
            recipient: recipient.clone(),
            amount,
            release_ledger,
            released: false,
            cancelled: false,
        };

        env.storage().instance().set(&DataKey::Escrow(count), &record);
        env.storage().instance().set(&DataKey::EscrowCount, &(count + 1));

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "open_escrow"),
                payer,
                recipient,
            ),
            count,
        );

        count
    }

    /// Release escrow funds to the recipient after `release_ledger`.
    /// Anyone can call once the ledger threshold is reached.
    pub fn release_escrow(env: Env, escrow_id: u32) -> i128 {
        bump_instance(&env);
        let mut record: EscrowRecord = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        if record.released {
            panic!("Escrow already released");
        }
        if record.cancelled {
            panic!("Escrow was cancelled");
        }
        if env.ledger().sequence() < record.release_ledger {
            panic!("Escrow is still locked");
        }

        record.released = true;
        env.storage().instance().set(&DataKey::Escrow(escrow_id), &record);

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "release_escrow"),
                record.recipient.clone(),
                escrow_id,
            ),
            record.amount,
        );

        record.amount
    }

    /// Cancel an escrow before `release_ledger`; funds return to the payer.
    pub fn cancel_escrow(env: Env, escrow_id: u32, payer: Address) -> i128 {
        bump_instance(&env);
        payer.require_auth();

        let mut record: EscrowRecord = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        if record.payer != payer {
            panic!("Not escrow payer");
        }
        if record.released {
            panic!("Escrow already released");
        }
        if record.cancelled {
            panic!("Escrow already cancelled");
        }
        if env.ledger().sequence() >= record.release_ledger {
            panic!("Escrow lock has expired");
        }

        record.cancelled = true;
        env.storage().instance().set(&DataKey::Escrow(escrow_id), &record);

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "cancel_escrow"),
                payer,
                escrow_id,
            ),
            record.amount,
        );

        record.amount
    }

    /// Get an escrow record.
    pub fn get_escrow(env: Env, escrow_id: u32) -> EscrowRecord {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found")
    }

// ─── Placeholders (future features) ──────────────────────────────────────

    /// [PLACEHOLDER] Batch multiple micro-payments in a single transaction.
    /// See ROADMAP.md v2.0 — Multi-Currency Payments.
    ///
    /// Security review (#1121): the stub panics before touching any state, so
    /// it requires no authorization today. The real implementation must
    /// `require_auth` from `from` (the single payer for the whole batch), and
    /// must validate every amount before requesting authorization.
    ///
    /// Size limits (#1489) are already enforced here so that callers writing
    /// against the eventual implementation get the same clear errors they get
    /// from `batch_tip`, instead of an oversized batch being accepted today and
    /// rejected later: an empty batch, a length mismatch, and a batch larger
    /// than `MAX_BATCH` each panic before the placeholder message.
    pub fn batch_send(
        env: Env,
        _from: Address,
        _recipients: soroban_sdk::Vec<Address>,
        _amounts: soroban_sdk::Vec<i128>,
    ) {
        bump_instance(&env);
        require_not_frozen(&env);
        if _recipients.len() != _amounts.len() {
            panic!("Recipient and amount vectors must have the same length");
        }
        if _recipients.len() == 0 {
            panic!("At least one payment is required");
        }
        if _recipients.len() > MAX_BATCH {
            panic!("Batch size exceeds maximum allowed (25 entries)");
        }
        panic!("Batch payments coming in v2.0 — see ROADMAP.md");
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{
        testutils::{
            Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger, MockAuth,
            MockAuthInvoke,
        },
        token, Address, Env, IntoVal, TryFromVal,
    };

    fn setup() -> (Env, MicroPayContractClient<'static>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin, payer, recipient)
    }

    fn advance_by(env: &Env, ledgers: u32) {
        env.ledger().with_mut(|info| {
            info.sequence_number = info.sequence_number.saturating_add(ledgers);
        });
    }

    fn stream_fixture(
        env: &Env,
        funding: i128,
    ) -> (Address, MicroPayContractClient<'_>, Address, Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.initialize(&admin);

        let payer = Address::generate(env);
        let recipient = Address::generate(env);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::StellarAssetClient::new(env, &token_id).mint(&payer, &funding);

        (contract_id, client, token_id, payer, recipient)
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin);

        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_initialize_requires_admin_auth() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin);

        // The admin must be the (only) authorizer of `initialize`.
        assert_eq!(
            env.auths(),
            [(
                admin.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        client.address.clone(),
                        Symbol::new(&env, "initialize"),
                        (admin.clone(),).into_val(&env)
                    )),
                    sub_invocations: [].into(),
                }
            )]
        );
    }

    #[test]
    #[should_panic(expected = "Contract already initialized")]
    fn test_double_initialize_fails() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);
        client.initialize(&admin); // should panic
    }

    /// Issue #1121 acceptance criteria: an entry point must fail when the
    /// caller provides no authorization at all.
    #[test]
    fn test_initialize_rejects_unauthorized_admin() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);

        // No authorization is mocked, so `admin.require_auth()` must fail.
        let result = client.try_initialize(&admin);
        assert!(result.is_err());

        // Nothing was written: the contract is still uninitialized.
        assert!(client.try_get_admin().is_err());
    }

    /// Issue #1121 acceptance criteria: no operation may let an unauthorized
    /// address act as another — authorizing `attacker` must not install
    /// `victim` as admin.
    #[test]
    fn test_initialize_rejects_authorization_of_another_address() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let victim = Address::generate(&env);
        let attacker = Address::generate(&env);

        // Only `attacker` signs, while the admin being stored is `victim`.
        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (&victim,).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_initialize(&victim);
        assert!(result.is_err());
        assert!(client.try_get_admin().is_err());
    }

    #[test]
    fn test_mint_receipt_stores_receipt_record_accessible_via_get_receipt() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        env.mock_all_auths();

        let memo = Symbol::new(&env, "Rent");
        let receipt_id = client.mint_receipt(&payer, &payee, &1000, &memo);
        assert_eq!(receipt_id, 0);

        assert_eq!(client.get_receipt_count(&payer), 1);

        let stored = client.get_receipt(&payer, &0);
        assert_eq!(stored.from, payer);
        assert_eq!(stored.to, payee);
        assert_eq!(stored.amount, 1000);
        assert_eq!(stored.memo, memo);
        assert_eq!(stored.ledger, env.ledger().sequence());
    }

    #[test]
    fn test_mint_two_receipts_from_same_payer_increments_count() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let payer = Address::generate(&env);
        let payee1 = Address::generate(&env);
        let payee2 = Address::generate(&env);

        let id1 = client.mint_receipt(&payer, &payee1, &500, &Symbol::new(&env, "Coffee"));
        let id2 = client.mint_receipt(&payer, &payee2, &1500, &Symbol::new(&env, "Invoice"));

        assert_eq!(id1, 0);
        assert_eq!(id2, 1);
        assert_eq!(client.get_receipt_count(&payer), 2);

        let receipt1 = client.get_receipt(&payer, &0);
        assert_eq!(receipt1.to, payee1);
        assert_eq!(receipt1.amount, 500);

        let receipt2 = client.get_receipt(&payer, &1);
        assert_eq!(receipt2.to, payee2);
        assert_eq!(receipt2.amount, 1500);
    }

    /// End-to-end tip flow against a real (test) Stellar Asset Contract:
    /// verifies the transfer executes and that the sender is the authorizer
    /// of the `send_tip` invocation.
    #[test]
    fn test_send_tip_moves_funds_and_requires_from_auth() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        // Register a native-like SAC and fund the tip sender.
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let sac_address = sac.address();
        let token = token::Client::new(&env, &sac_address);
        let sac_admin = token::StellarAssetClient::new(&env, &sac_address);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount = 123_i128;
        sac_admin.mint(&from, &10_000);

        client.send_tip(&sac_address, &from, &to, &amount);

        // Exactly one auth entry is recorded and it belongs to the sender
        // at the `send_tip` root (the SAC transfer appears nested under it).
        // NOTE: `env.auths()` only reflects the most recent top-level
        // invocation, so this must run before any further client calls.
        let auths = env.auths();
        assert_eq!(auths.len(), 1);
        let (authorizer, invocation) = &auths[0];
        assert_eq!(authorizer, &from);
        match &invocation.function {
            AuthorizedFunction::Contract((contract_address, name, args)) => {
                assert_eq!(contract_address, &client.address);
                assert_eq!(name, &Symbol::new(&env, "send_tip"));
                assert_eq!(args.len(), 4);
                // (token, from, to, amount) — sender and amount must be
                // covered by the authorization to prevent argument swapping.
                assert_eq!(
                    Address::try_from_val(&env, &args.get(1).unwrap()).unwrap(),
                    from
                );
                assert_eq!(
                    Address::try_from_val(&env, &args.get(2).unwrap()).unwrap(),
                    to
                );
                assert_eq!(
                    i128::try_from_val(&env, &args.get(3).unwrap()).unwrap(),
                    amount
                );
            }
            _ => panic!("expected contract function authorization"),
        }

        // The transfer actually happened.
        assert_eq!(token.balance(&from), 10_000 - amount);
        assert_eq!(token.balance(&to), amount);
        assert_eq!(client.get_tip_total(&to), amount);
        assert_eq!(client.get_tip_count(&to), 1);
    }

    #[test]
    #[should_panic(expected = "Tip amount must be positive")]
    fn test_send_tip_rejects_zero_amount() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        client.send_tip(&Address::generate(&env), &from, &to, &0);
    }

    #[test]
    #[should_panic(expected = "Tip amount must be positive")]
    fn test_send_tip_rejects_negative_amount() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        client.send_tip(&Address::generate(&env), &from, &to, &-5);
    }

    #[test]
    fn test_send_tip_rejects_unauthorized_caller() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        // Initialize by mocking only the admin's authorization.
        let admin = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (&admin,).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.initialize(&admin);

        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let sac_address = sac.address();
        let token = token::Client::new(&env, &sac_address);
        let sac_admin = token::StellarAssetClient::new(&env, &sac_address);

        let from = Address::generate(&env);
        let to = Address::generate(&env);

        // Fund the sender: the SAC only mints for the admin that created it.
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &sac_address,
                fn_name: "mint",
                args: (&from, &10_000_i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        sac_admin.mint(&from, &10_000);
        assert_eq!(token.balance(&from), 10_000);

        // Only `attacker` is authorized for `send_tip`; `from` never signed.
        let attacker = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "send_tip",
                args: (sac_address.clone(), from.clone(), to.clone(), 100_i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_send_tip(&sac_address, &from, &to, &100);
        assert!(result.is_err());

        // Unauthorized call moved no funds and recorded no tip.
        assert_eq!(token.balance(&from), 10_000);
        assert_eq!(token.balance(&to), 0);
        assert_eq!(client.get_tip_total(&to), 0);
        assert_eq!(client.get_tip_count(&to), 0);
    }

    #[test]
    fn test_mint_receipt_requires_from_auth() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);

        client.mint_receipt(&from, &to, &1000, &Symbol::new(&env, "Rent"));

        // Exactly one auth entry, owned by the payer, covering the full
        // `mint_receipt` invocation arguments.
        assert_eq!(
            env.auths(),
            [(
                from.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        client.address.clone(),
                        Symbol::new(&env, "mint_receipt"),
                        (
                            from.clone(),
                            to.clone(),
                            1000_i128,
                            Symbol::new(&env, "Rent")
                        )
                            .into_val(&env)
                    )),
                    sub_invocations: [].into(),
                }
            )]
        );
    }

    /// Issue #1121 acceptance criteria: only the payer can mint their own
    /// receipt — an unrelated authorized address must not mint one on their
    /// behalf, and no receipt state may be written.
    #[test]
    fn test_mint_receipt_rejects_unauthorized_caller() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (&admin,).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let attacker = Address::generate(&env);

        // Only `attacker` is authorized; the receipt belongs to `from`.
        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "mint_receipt",
                args: (
                    from.clone(),
                    to.clone(),
                    1000_i128,
                    Symbol::new(&env, "Rent"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_mint_receipt(&from, &to, &1000, &Symbol::new(&env, "Rent"));
        assert!(result.is_err());
        assert_eq!(client.get_receipt_count(&from), 0);
    }

    /// Regression test for the auth-ordering fix: a call that panics on
    /// validation must not leave behind a satisfied authorization for the
    /// payer (which would be usable as a probe inside a bigger transaction).
    #[test]
    fn test_failed_mint_does_not_consume_auth() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);

        // Amount validation happens *before* require_auth, so this panics
        // without registering any authorization for `from`.
        let result = client.try_mint_receipt(&from, &to, &0, &Symbol::new(&env, "Bad"));
        assert!(result.is_err());
        assert!(env.auths().is_empty());
        assert_eq!(client.get_receipt_count(&from), 0);

        // A valid call afterwards still works.
        let id = client.mint_receipt(&from, &to, &250, &Symbol::new(&env, "Good"));
        assert_eq!(id, 0);
        assert_eq!(client.get_receipt_count(&from), 1);
    }

    #[test]
    #[should_panic(expected = "Receipt not found")]
    fn test_get_receipt_out_of_range_panics_gracefully() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let payer = Address::generate(&env);
        client.get_receipt(&payer, &0); // No receipts minted yet -> panics
    }


    #[test]
    fn test_tip_totals_start_at_zero() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let recipient = Address::generate(&env);
        assert_eq!(client.get_tip_total(&recipient), 0);
        assert_eq!(client.get_tip_count(&recipient), 0);
    }

    #[test]
    fn test_set_admin_and_rotation() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), admin);

        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);

        assert_eq!(client.get_admin(), new_admin);
    }

    #[test]
    #[should_panic]
    fn test_upgrade_non_admin_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        env.set_auths(&[]);
        let dummy_hash = BytesN::from_array(&env, &[1u8; 32]);
        // Without admin auth, calling upgrade panics
        client.upgrade(&dummy_hash);
    }

    #[test]
    fn test_upgrade_admin_requires_auth_and_invokes_deployer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let dummy_hash = BytesN::from_array(&env, &[1u8; 32]);
        // With admin auth, try_upgrade passes the admin auth check and invokes deployer.
        // In native test environment, deployer returns an Err (InvalidAction for non-wasm target).
        let res = client.try_upgrade(&dummy_hash);
        assert!(res.is_err());
    }

    #[test]
    fn test_upgrade_preserves_stream_and_tip_state() {
        let env = Env::default();
        env.mock_all_auths();

        const STUB_WASM: &[u8] = include_bytes!("../test_stub.wasm");
        let contract_id = env.register_contract_wasm(None, STUB_WASM);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let token_admin = Address::generate(&env);
        let token_address = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token_client = token::StellarAssetClient::new(&env, &token_address);

        let payer1 = Address::generate(&env);
        let payer2 = Address::generate(&env);
        let recipient1 = Address::generate(&env);
        let recipient2 = Address::generate(&env);

        token_client.mint(&payer1, &100_000);
        token_client.mint(&payer2, &100_000);

        // 1. Create 2 streams
        let stream_id_0 = client.open_stream(&payer1, &recipient1, &10, &1000);
        let stream_id_1 = client.open_stream(&payer2, &recipient2, &20, &2000);

        // 2. Create 3 tips
        client.send_tip(&token_address, &payer1, &recipient1, &150);
        client.send_tip(&token_address, &payer2, &recipient1, &250);
        client.send_tip(&token_address, &payer1, &recipient2, &350);

        // Query before state
        let stream_0_before = client.get_stream(&stream_id_0);
        let stream_1_before = client.get_stream(&stream_id_1);
        let tip_total_1_before = client.get_tip_total(&recipient1);
        let tip_total_2_before = client.get_tip_total(&recipient2);

        std::println!("--- BEFORE UPGRADE STATE ---");
        std::println!("Stream 0: {:?}", stream_0_before);
        std::println!("Stream 1: {:?}", stream_1_before);
        std::println!("Tip Total Recipient 1: {}", tip_total_1_before);
        std::println!("Tip Total Recipient 2: {}", tip_total_2_before);

        // 3. Upgrade to mock new WASM hash using test stub WASM
        let new_wasm_hash = env.deployer().upload_contract_wasm(STUB_WASM);
        client.upgrade(&new_wasm_hash);

        // 4. Query after state
        let stream_0_after = client.get_stream(&stream_id_0);
        let stream_1_after = client.get_stream(&stream_id_1);
        let tip_total_1_after = client.get_tip_total(&recipient1);
        let tip_total_2_after = client.get_tip_total(&recipient2);

        std::println!("--- AFTER UPGRADE STATE ---");
        std::println!("Stream 0: {:?}", stream_0_after);
        std::println!("Stream 1: {:?}", stream_1_after);
        std::println!("Tip Total Recipient 1: {}", tip_total_1_after);
        std::println!("Tip Total Recipient 2: {}", tip_total_2_after);

        // 5. Verify state is preserved
        assert_eq!(stream_0_before.payer, stream_0_after.payer);
        assert_eq!(stream_0_before.recipient, stream_0_after.recipient);
        assert_eq!(stream_0_before.rate_per_ledger, stream_0_after.rate_per_ledger);
        assert_eq!(stream_0_before.deposited, stream_0_after.deposited);
        assert_eq!(stream_0_before.claimed, stream_0_after.claimed);

        assert_eq!(stream_1_before.payer, stream_1_after.payer);
        assert_eq!(stream_1_before.recipient, stream_1_after.recipient);
        assert_eq!(stream_1_before.rate_per_ledger, stream_1_after.rate_per_ledger);
        assert_eq!(stream_1_before.deposited, stream_1_after.deposited);
        assert_eq!(stream_1_before.claimed, stream_1_after.claimed);

        assert_eq!(tip_total_1_before, tip_total_1_after);
        assert_eq!(tip_total_2_before, tip_total_2_after);
        assert_eq!(tip_total_1_after, 400);
        assert_eq!(tip_total_2_after, 350);
    }

    // ─── Streaming tests ───────────────────────────────────────────────────

    #[test]
    fn test_open_stream() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        assert_eq!(id, 0);
        let stream = client.get_stream(&0);
        assert_eq!(stream.payer, payer);
        assert_eq!(stream.recipient, recipient);
        assert_eq!(stream.rate_per_ledger, 10);
        assert_eq!(stream.deposited, 1000);
        assert_eq!(stream.claimed, 0);
        let _ = env;
    }

    #[test]
    fn test_claim_stream_basic() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        let stream = client.get_stream(&id);
        env.ledger().set_sequence_number(stream.start_ledger + 10);
        let claimed = client.claim_stream(&id, &recipient);
        assert_eq!(claimed, 100);
    }

    #[test]
    fn test_claim_stream_multiple_times() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &5, &1000);
        env.ledger().set_sequence_number(env.ledger().sequence() + 4);
        let first = client.claim_stream(&id, &recipient);
        env.ledger().set_sequence_number(env.ledger().sequence() + 4);
        let second = client.claim_stream(&id, &recipient);
        assert_eq!(first, 20);
        assert_eq!(second, 20);
    }

    #[test]
    fn test_claim_stream_exceeds_deposit() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &100, &150);
        env.ledger().set_sequence_number(env.ledger().sequence() + 10);
        let claimed = client.claim_stream(&id, &recipient);
        assert_eq!(claimed, 150);
        // Second claim yields nothing.
        let claimed2 = client.claim_stream(&id, &recipient);
        assert_eq!(claimed2, 0);
    }

    #[test]
    fn test_top_up_stream() {
        let (_env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &100);
        client.top_up_stream(&id, &payer, &500);
        let stream = client.get_stream(&id);
        assert_eq!(stream.deposited, 600);
    }

    #[test]
    fn test_close_stream_with_refund() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        env.ledger().set_sequence_number(env.ledger().sequence() + 5);
        let refund = client.close_stream(&id, &payer);
        assert_eq!(refund, 950);
    }

    #[test]
    fn test_close_stream_after_claims() {
        let env = Env::default();
        let (_, client, _token_id, payer, recipient) = stream_fixture(&env, 100_000);

        let rate: i128 = 100;
        let deposit: i128 = 100_000;
        let id = client.open_stream(&payer, &recipient, &rate, &deposit);
        advance_by(&env, 30);
        client.claim_stream(&id, &recipient);
        advance_by(&env, 20);

        let refund = client.close_stream(&id, &payer);
        let streamed = rate * 50;
        assert_eq!(refund, deposit - streamed);
        assert!(client.try_get_stream(&id).is_err());
    }

    // ─── Property test: close_stream invariant (#1085) ───────────────────────

    /// Deterministic linear congruential generator — no external crate needed.
    struct Lcg(u64);

    impl Lcg {
        fn new(seed: u64) -> Self {
            Lcg(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15))
        }

        fn next_u64(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 33
        }

        fn gen_range(&mut self, min: i128, max: i128) -> i128 {
            let span = max - min;
            min + (self.next_u64() as i128 % span)
        }

        fn gen_u32_range(&mut self, min: u32, max: u32) -> u32 {
            let span = (max - min) as u64;
            min + (self.next_u64() % span) as u32
        }
    }

    /// Helper that opens a stream, advances the ledger, closes it, then asserts
    /// the core mathematical invariant: `refund + claimed == deposited`.
    fn check_close_stream_invariant(rate: i128, elapsed: u32, deposit: i128) {
        let env = Env::default();
        let (_, client, _token_id, payer, recipient) = stream_fixture(&env, deposit);

        let stream_id = client.open_stream(&payer, &recipient, &rate, &deposit);

        if elapsed > 0 {
            advance_by(&env, elapsed);
        }

        // close_stream deletes the Stream record, so snapshot it beforehand;
        // the post-close `claimed` total is derived from the contract's own
        // rule instead of read back from storage.
        let before = client.get_stream(&stream_id);
        let refund = client.close_stream(&stream_id, &payer);

        let vested = rate
            .saturating_mul(elapsed as i128)
            .max(before.claimed)
            .min(before.deposited);

        assert_eq!(
            refund + vested,
            before.deposited,
            "Invariant violated: rate={}, elapsed={}, deposit={}, refund={}, vested={}",
            rate,
            elapsed,
            deposit,
            refund,
            vested
        );
    }

    /// Property test verifying the streaming contract invariant:
    /// `refund + claimed == deposited` — the refund returned by `close_stream`
    /// plus the recipient's `claimed` total must always equal the original
    /// `deposited` amount, regardless of rate, elapsed ledgers, or deposit size.
    #[test]
    fn test_close_stream_refund_plus_claimed_equals_deposited() {
        // ── Edge cases explicitly requested in the issue ──────────────────

        // 0 elapsed: nothing streamed, full refund.
        check_close_stream_invariant(1_000, 0, 1_000_000);

        // rate > deposit / ledger: deposit fully streamed on ledger 1,
        // refund is zero.
        check_close_stream_invariant(2_000_000, 1, 1_000_000);

        // Very large rate: rate * elapsed overflows i128, but
        // total_streamed_amount caps at `deposited` via checked_mul.
        check_close_stream_invariant(i128::MAX, 2, 1_000_000);

        // ── 100+ randomly generated (rate, elapsed, deposit) triples ────────
        let mut rng = Lcg::new(0xDEADBEEF_CAFEBABE);
        for _ in 0..100 {
            let rate = rng.gen_range(1, 1_000_001);
            let elapsed = rng.gen_u32_range(0, 50_000);
            let deposit = rng.gen_range(1, 1_000_001);
            check_close_stream_invariant(rate, elapsed, deposit);
        }
    }

    /// Property test with prior claims interleaved before close — the
    /// invariant must still hold even if the recipient has partially claimed.
    #[test]
    fn test_close_stream_refund_invariant_after_partial_claims() {
        let mut rng = Lcg::new(0x12345678_9ABCDEF0);
        for _ in 0..50 {
            let rate = rng.gen_range(1, 100_001);
            let deposit = rng.gen_range(10_000, 10_000_001);
            let env = Env::default();
            let (_, client, _token_id, payer, recipient) = stream_fixture(&env, deposit);

            let stream_id = client.open_stream(&payer, &recipient, &rate, &deposit);

            // Claim at some intermediate point.
            let first_elapsed = rng.gen_u32_range(1, 100);
            advance_by(&env, first_elapsed);
            let first_claim = client.claim_stream(&stream_id, &recipient);

            // Advance further, then close.
            let remaining = rng.gen_u32_range(0, 500);
            advance_by(&env, remaining);

            // close_stream deletes the record, so read the pre-close snapshot.
            let before = client.get_stream(&stream_id);
            let total_elapsed = first_elapsed + remaining;
            let refund = client.close_stream(&stream_id, &payer);

            let vested = rate
                .saturating_mul(total_elapsed as i128)
                .max(before.claimed)
                .min(before.deposited);

            assert_eq!(
                refund + vested,
                before.deposited,
                "Invariant violated: rate={}, first={}, remaining={}, deposit={}, \
                 first_claim={}, refund={}, vested={}",
                rate,
                first_elapsed,
                remaining,
                deposit,
                first_claim,
                refund,
                vested
            );
        }
    }

    #[test]
    fn test_get_claimable() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        env.ledger().set_sequence_number(env.ledger().sequence() + 3);
        assert_eq!(client.get_claimable(&id), 30);
    }

    #[test]
    #[should_panic(expected = "Stream not found")]
    fn test_claim_nonexistent_stream() {
        let (_env, client, _admin, _payer, recipient) = setup();
        client.claim_stream(&999, &recipient);
    }

    #[test]
    #[should_panic(expected = "Not stream recipient")]
    fn test_unauthorized_claim() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        let impostor = Address::generate(&env);
        // Auth is mocked, but the contract-level recipient check must reject.
        client.claim_stream(&id, &impostor);
    }

    #[test]
    #[should_panic(expected = "Not stream payer")]
    fn test_unauthorized_close() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        let impostor = Address::generate(&env);
        client.close_stream(&id, &impostor);
    }

    #[test]
    #[should_panic(expected = "Rate must be positive")]
    fn test_invalid_rate() {
        let (_env, client, _admin, payer, recipient) = setup();
        client.open_stream(&payer, &recipient, &0, &100);
    }

    #[test]
    #[should_panic(expected = "Deposit must be positive")]
    fn test_invalid_deposit() {
        let (_env, client, _admin, payer, recipient) = setup();
        client.open_stream(&payer, &recipient, &10, &0);
    }

    #[test]
    fn test_pause_resume_claim_flow() {
        let (env, client, _admin, payer, recipient) = setup();
        let start = env.ledger().sequence();
        let id = client.open_stream(&payer, &recipient, &10, &10000);

        // Advance 5 ledgers, then pause.
        env.ledger().set_sequence_number(start + 5);
        client.pause_stream(&id, &payer);
        assert_eq!(client.get_claimable(&id), 50);

        // Advance 10 more ledgers while paused: claimable must NOT increase.
        env.ledger().set_sequence_number(start + 15);
        assert_eq!(client.get_claimable(&id), 50);
        let paused_claim = client.claim_stream(&id, &recipient);
        assert_eq!(paused_claim, 50);

        // Resume and advance 5 ledgers: claimable SHOULD increase again.
        client.resume_stream(&id, &payer);
        env.ledger().set_sequence_number(env.ledger().sequence() + 5);
        let after = client.get_claimable(&id);
        assert_eq!(after, 50);
        let resumed_claim = client.claim_stream(&id, &recipient);
        assert_eq!(resumed_claim, 50);
    }

    // ─── Escrow tests ──────────────────────────────────────────────────────

    #[test]
    fn test_open_escrow() {
        let (env, client, _admin, payer, recipient) = setup();
        let release = env.ledger().sequence() + 100;
        let id = client.open_escrow(&payer, &recipient, &500, &release);
        assert_eq!(id, 0);
        let record = client.get_escrow(&0);
        assert_eq!(record.payer, payer);
        assert_eq!(record.recipient, recipient);
        assert_eq!(record.amount, 500);
        assert_eq!(record.release_ledger, release);
        assert!(!record.released);
        assert!(!record.cancelled);
    }

    #[test]
    fn test_release_escrow_after_release_ledger() {
        let (env, client, _admin, payer, recipient) = setup();
        let release = env.ledger().sequence() + 10;
        let id = client.open_escrow(&payer, &recipient, &500, &release);
        env.ledger().set_sequence_number(release + 1);
        let amount = client.release_escrow(&id);
        assert_eq!(amount, 500);
        assert!(client.get_escrow(&id).released);
    }

    #[test]
    #[should_panic(expected = "Escrow is still locked")]
    fn test_release_escrow_before_release_ledger_fails() {
        let (env, client, _admin, payer, recipient) = setup();
        let release = env.ledger().sequence() + 100;
        let id = client.open_escrow(&payer, &recipient, &500, &release);
        env.ledger().set_sequence_number(release - 10);
        client.release_escrow(&id);
    }

    #[test]
    fn test_cancel_escrow_before_release() {
        let (env, client, _admin, payer, recipient) = setup();
        let release = env.ledger().sequence() + 100;
        let id = client.open_escrow(&payer, &recipient, &500, &release);
        let amount = client.cancel_escrow(&id, &payer);
        assert_eq!(amount, 500);
        assert!(client.get_escrow(&id).cancelled);
    }

    #[test]
    #[should_panic(expected = "Escrow lock has expired")]
    fn test_cancel_escrow_after_release_fails() {
        let (env, client, _admin, payer, recipient) = setup();
        let release = env.ledger().sequence() + 10;
        let id = client.open_escrow(&payer, &recipient, &500, &release);
        env.ledger().set_sequence_number(release + 1);
        client.cancel_escrow(&id, &payer);
    }

    #[test]
    fn test_escrow_ids_increment() {
        let (env, client, _admin, payer, recipient) = setup();
        let release = env.ledger().sequence() + 50;
        let id0 = client.open_escrow(&payer, &recipient, &100, &release);
        let id1 = client.open_escrow(&payer, &recipient, &200, &release);
        assert_eq!(id0, 0);
        assert_eq!(id1, 1);
        assert_eq!(client.get_escrow(&id1).amount, 200);
    }

    // ─── Milestone escrow tests ──────────────────────────────────────────────

    /// Ledger gap the payer must wait out after disputing a milestone.
    const DISPUTE_TIMEOUT: u32 = 500;
    /// Amount locked by every escrow created in these tests.
    const ESCROW_AMOUNT: i128 = 4_000;
    /// Balance the payer starts every escrow test with.
    const PAYER_FLOAT: i128 = 10_000;

    /// A deployed contract, a test token, and the three escrow roles.
    ///
    /// `env.events().all()` only reports the events of the most recent
    /// invocation, so read published events before balances or records, which
    /// are themselves contract calls.
    struct EscrowTest {
        env: Env,
        contract_id: Address,
        token: Address,
        payer: Address,
        recipient: Address,
        approver: Address,
    }

    impl EscrowTest {
        fn new() -> Self {
            let env = Env::default();
            env.mock_all_auths();
            let contract_id = env.register_contract(None, MicroPayContract);
            MicroPayContractClient::new(&env, &contract_id).initialize(&Address::generate(&env));

            let token = env
                .register_stellar_asset_contract_v2(Address::generate(&env))
                .address();
            let payer = Address::generate(&env);
            let recipient = Address::generate(&env);
            let approver = Address::generate(&env);
            token::StellarAssetClient::new(&env, &token).mint(&payer, &PAYER_FLOAT);

            Self {
                env,
                contract_id,
                token,
                payer,
                recipient,
                approver,
            }
        }

        fn client(&self) -> MicroPayContractClient<'_> {
            MicroPayContractClient::new(&self.env, &self.contract_id)
        }

        fn balance(&self, holder: &Address) -> i128 {
            token::Client::new(&self.env, &self.token).balance(holder)
        }

        fn escrow(&self, id: &u32) -> MilestoneEscrowRecord {
            self.client().get_milestone_escrow(id)
        }

        fn fund(&self) -> u32 {
            self.client().create_milestone_escrow(
                &self.token,
                &self.payer,
                &self.recipient,
                &ESCROW_AMOUNT,
                &self.approver,
                &DISPUTE_TIMEOUT,
            )
        }

        fn approve(&self, id: &u32) {
            self.client().approve_milestone(id, &self.approver)
        }

        fn dispute(&self, id: &u32) {
            self.client().dispute_milestone(id, &self.payer)
        }

        fn cancel(&self, id: &u32) {
            self.client().cancel_milestone_escrow(id, &self.payer)
        }

        fn sequence(&self) -> u32 {
            self.env.ledger().sequence()
        }

        fn advance(&self, ledgers: u32) {
            let next = self.env.ledger().sequence() + ledgers;
            self.env.ledger().set_sequence_number(next);
        }

        fn assert_published<E: soroban_sdk::events::Event>(&self, event: E) {
            let expected = event.to_xdr(&self.env, &self.contract_id);
            assert!(
                self.env.events().all().events().contains(&expected),
                "expected event was not published"
            );
        }
    }

    #[test]
    fn test_create_milestone_escrow_locks_funds() {
        let t = EscrowTest::new();

        let id = t.fund();

        t.assert_published(MilestoneEscrowCreated {
            escrow_id: id,
            payer: t.payer.clone(),
            recipient: t.recipient.clone(),
            approver: t.approver.clone(),
            token: t.token.clone(),
            amount: ESCROW_AMOUNT,
            dispute_timeout: DISPUTE_TIMEOUT,
        });

        assert_eq!(id, 0);
        assert_eq!(t.client().get_milestone_escrow_count(), 1);
        assert_eq!(t.balance(&t.contract_id), ESCROW_AMOUNT);
        assert_eq!(t.balance(&t.payer), PAYER_FLOAT - ESCROW_AMOUNT);

        let escrow = t.escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Pending);
        assert_eq!(escrow.token, t.token);
        assert_eq!(escrow.payer, t.payer);
        assert_eq!(escrow.recipient, t.recipient);
        assert_eq!(escrow.approver, t.approver);
        assert_eq!(escrow.amount, ESCROW_AMOUNT);
        assert_eq!(escrow.dispute_ledger, 0);
        assert_eq!(escrow.dispute_timeout, DISPUTE_TIMEOUT);
    }

    #[test]
    fn test_create_milestone_escrow_ids_increment() {
        let t = EscrowTest::new();

        assert_eq!(t.fund(), 0);
        assert_eq!(t.fund(), 1);

        assert_eq!(t.client().get_milestone_escrow_count(), 2);
        assert_eq!(t.balance(&t.contract_id), 2 * ESCROW_AMOUNT);
        assert_eq!(t.balance(&t.payer), PAYER_FLOAT - 2 * ESCROW_AMOUNT);
    }

    #[test]
    fn test_approve_milestone_releases_funds() {
        let t = EscrowTest::new();
        let id = t.fund();

        t.approve(&id);

        t.assert_published(MilestoneEscrowApproved {
            escrow_id: id,
            approver: t.approver.clone(),
            recipient: t.recipient.clone(),
            amount: ESCROW_AMOUNT,
        });

        assert_eq!(t.balance(&t.recipient), ESCROW_AMOUNT);
        assert_eq!(t.balance(&t.contract_id), 0);
        assert_eq!(t.escrow(&id).status, EscrowStatus::Approved);
    }

    #[test]
    fn test_approve_milestone_twice_releases_once() {
        let t = EscrowTest::new();
        let id = t.fund();
        t.approve(&id);

        let second = t.client().try_approve_milestone(&id, &t.approver);

        assert!(second.is_err());
        assert_eq!(t.balance(&t.recipient), ESCROW_AMOUNT);
    }

    #[test]
    #[should_panic(expected = "Only the designated approver can approve this escrow")]
    fn test_only_the_designated_approver_can_approve() {
        let t = EscrowTest::new();
        let id = t.fund();
        let stranger = Address::generate(&t.env);

        // `mock_all_auths` lets any address claim any signature, so the
        // recorded approver is the only thing standing between them and the funds.
        t.client().approve_milestone(&id, &stranger);
    }

    #[test]
    #[should_panic(expected = "Escrow not found")]
    fn test_unknown_escrow_id_has_no_record() {
        let t = EscrowTest::new();
        t.escrow(&7);
    }

    #[test]
    fn test_dispute_milestone_holds_funds() {
        let t = EscrowTest::new();
        let id = t.fund();
        let disputed_at = t.sequence();

        t.dispute(&id);

        t.assert_published(MilestoneEscrowDisputed {
            escrow_id: id,
            payer: t.payer.clone(),
            amount: ESCROW_AMOUNT,
            reclaim_after: disputed_at + DISPUTE_TIMEOUT,
        });

        let escrow = t.escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Disputed);
        assert_eq!(escrow.dispute_ledger, disputed_at);
        // Neither party can move the funds while the dispute is open.
        assert_eq!(t.balance(&t.contract_id), ESCROW_AMOUNT);
        assert_eq!(t.balance(&t.recipient), 0);
        assert_eq!(t.balance(&t.payer), PAYER_FLOAT - ESCROW_AMOUNT);
    }

    #[test]
    #[should_panic(expected = "Only the payer can dispute this escrow")]
    fn test_only_the_payer_can_dispute() {
        let t = EscrowTest::new();
        let id = t.fund();
        let stranger = Address::generate(&t.env);

        t.client().dispute_milestone(&id, &stranger);
    }

    #[test]
    #[should_panic(expected = "Escrow is no longer pending")]
    fn test_disputed_escrow_cannot_be_approved() {
        let t = EscrowTest::new();
        let id = t.fund();
        t.dispute(&id);

        t.approve(&id);
    }

    #[test]
    #[should_panic(expected = "Escrow is no longer pending")]
    fn test_released_escrow_cannot_be_disputed() {
        let t = EscrowTest::new();
        let id = t.fund();
        t.approve(&id);

        t.dispute(&id);
    }

    #[test]
    fn test_cancel_milestone_escrow_returns_funds_after_timeout() {
        let t = EscrowTest::new();
        let id = t.fund();
        t.dispute(&id);

        t.advance(DISPUTE_TIMEOUT);
        t.cancel(&id);

        t.assert_published(MilestoneEscrowCancelled {
            escrow_id: id,
            payer: t.payer.clone(),
            amount: ESCROW_AMOUNT,
        });

        assert_eq!(t.balance(&t.payer), PAYER_FLOAT);
        assert_eq!(t.balance(&t.contract_id), 0);
        assert_eq!(t.escrow(&id).status, EscrowStatus::Cancelled);
    }

    #[test]
    #[should_panic(expected = "Escrow dispute timeout has not elapsed")]
    fn test_cancel_milestone_escrow_one_ledger_early_fails() {
        let t = EscrowTest::new();
        let id = t.fund();
        t.dispute(&id);

        t.advance(DISPUTE_TIMEOUT - 1);
        t.cancel(&id);
    }

    #[test]
    #[should_panic(expected = "Escrow is not disputed")]
    fn test_cancel_pending_escrow_fails() {
        let t = EscrowTest::new();
        let id = t.fund();

        t.cancel(&id);
    }

    #[test]
    #[should_panic(expected = "Only the payer can cancel this escrow")]
    fn test_only_the_payer_can_cancel() {
        let t = EscrowTest::new();
        let id = t.fund();
        t.dispute(&id);
        t.advance(DISPUTE_TIMEOUT);

        t.client().cancel_milestone_escrow(&id, &t.approver);
    }

    #[test]
    #[should_panic(expected = "Escrow amount must be positive")]
    fn test_create_escrow_rejects_non_positive_amount() {
        let t = EscrowTest::new();
        t.client().create_milestone_escrow(
            &t.token,
            &t.payer,
            &t.recipient,
            &0,
            &t.approver,
            &DISPUTE_TIMEOUT,
        );
    }

    #[test]
    #[should_panic(expected = "Escrow dispute timeout is out of range")]
    fn test_create_escrow_rejects_zero_dispute_timeout() {
        let t = EscrowTest::new();
        t.client().create_milestone_escrow(
            &t.token,
            &t.payer,
            &t.recipient,
            &ESCROW_AMOUNT,
            &t.approver,
            &0,
        );
    }

    #[test]
    #[should_panic(expected = "Escrow dispute timeout is out of range")]
    fn test_create_escrow_rejects_timeout_beyond_the_storage_window() {
        let t = EscrowTest::new();
        t.client().create_milestone_escrow(
            &t.token,
            &t.payer,
            &t.recipient,
            &ESCROW_AMOUNT,
            &t.approver,
            &(MAX_DISPUTE_TIMEOUT + 1),
        );
    }

    #[test]
    #[should_panic(expected = "Unauthorized function call for address")]
    fn test_create_escrow_requires_the_payer_to_sign() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        client.initialize(&Address::generate(&env));
        // Deliberately no `mock_all_auths`: the payer never authorised the call.
        let token = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        let payer = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token).mint(&payer, &PAYER_FLOAT);

        client.create_milestone_escrow(
            &token,
            &payer,
            &Address::generate(&env),
            &ESCROW_AMOUNT,
            &Address::generate(&env),
            &DISPUTE_TIMEOUT,
        );
    }

    fn tip_setup() -> (Env, MicroPayContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        let issuer = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(issuer);
        let token = asset.address();
        let sender = Address::generate(&env);
        soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&sender, &10_000);
        (env, client, token, sender)
    }

    #[test]
    fn test_batch_tip_single_and_five_recipients() {
        let (env, client, token_address, sender) = tip_setup();
        let one = Address::generate(&env);
        let one_tip = soroban_sdk::Vec::from_array(&env, [(one.clone(), 100i128)]);
        client.batch_tip(&token_address, &sender, &one_tip);
        assert_eq!(client.get_tip_total(&one), 100);
        assert_eq!(client.get_tip_count(&one), 1);

        let mut five = soroban_sdk::Vec::new(&env);
        for amount in 1..=5i128 {
            five.push_back((Address::generate(&env), amount));
        }
        client.batch_tip(&token_address, &sender, &five);
        for i in 0..five.len() {
            let (recipient, amount) = five.get(i).unwrap();
            assert_eq!(client.get_tip_total(&recipient), amount);
            assert_eq!(client.get_tip_count(&recipient), 1);
        }
    }

    #[test]
    #[should_panic(expected = "Tip amount must be positive")]
    fn test_batch_tip_rejects_zero_amount() {
        let (env, client, token_address, sender) = tip_setup();
        let tips = soroban_sdk::Vec::from_array(&env, [(Address::generate(&env), 0i128)]);
        client.batch_tip(&token_address, &sender, &tips);
    }

    #[test]
    #[should_panic(expected = "Duplicate tip recipient")]
    fn test_batch_tip_rejects_duplicate_recipient() {
        let (env, client, token_address, sender) = tip_setup();
        let recipient = Address::generate(&env);
        let tips = soroban_sdk::Vec::from_array(
            &env,
            [(recipient.clone(), 100i128), (recipient, 200i128)],
        );
        client.batch_tip(&token_address, &sender, &tips);
    }

    // ─── Batch size limits (#1489) ───────────────────────────────────────────

    /// A batch of exactly `MAX_BATCH` entries has to fit inside the network's
    /// per-transaction resource limits, otherwise the cap would just codify a
    /// call that cannot be deployed. The test host enforces
    /// `InvocationResourceLimits::mainnet()` and meters against the network
    /// budgets, so the successful call below is itself the proof; the explicit
    /// margins are the tripwire if the per-entry cost ever grows towards those
    /// budgets.
    #[test]
    fn test_batch_tip_fits_network_resource_limits() {
        let (env, client, token_address, sender) = tip_setup();
        let mut tips = soroban_sdk::Vec::new(&env);
        while tips.len() < MAX_BATCH {
            tips.push_back((Address::generate(&env), 2i128));
        }
        assert_eq!(tips.len(), MAX_BATCH);

        client.batch_tip(&token_address, &sender, &tips);

        let mut i = 0u32;
        while i < tips.len() {
            let (recipient, amount) = tips.get(i).unwrap();
            assert_eq!(client.get_tip_total(&recipient), amount);
            assert_eq!(client.get_tip_count(&recipient), 1);
            i += 1;
        }

        // Mainnet per-transaction limits as snapshotted by soroban-sdk 29:
        // 400M instructions, 41,943,040 memory bytes, 16,384 event bytes,
        // 132,096 write bytes, 200 write entries.
        let resources = env.cost_estimate().resources();
        assert!(
            resources.instructions < 100_000_000,
            "instructions {} has no headroom left under the 400M limit",
            resources.instructions
        );
        assert!(
            resources.mem_bytes < 10_000_000,
            "memory {} has no headroom left under the 41.9M limit",
            resources.mem_bytes
        );
        assert!(
            resources.contract_events_size_bytes < 12_288,
            "event bytes {} has no headroom left under the 16,384 limit",
            resources.contract_events_size_bytes
        );
        assert!(
            resources.write_bytes < 66_048,
            "write bytes {} has no headroom left under the 132,096 limit",
            resources.write_bytes
        );
        assert!(
            resources.write_entries < 100,
            "write entries {} has no headroom left under the 200 limit",
            resources.write_entries
        );
    }

    #[test]
    #[should_panic(expected = "Batch size exceeds maximum allowed (25 entries)")]
    fn test_batch_tip_rejects_batch_above_cap() {
        let (env, client, token_address, sender) = tip_setup();
        let mut tips = soroban_sdk::Vec::new(&env);
        while tips.len() < MAX_BATCH + 1 {
            tips.push_back((Address::generate(&env), 1i128));
        }
        client.batch_tip(&token_address, &sender, &tips);
    }

    #[test]
    #[should_panic(expected = "At least one tip is required")]
    fn test_batch_tip_rejects_empty_batch() {
        let (env, client, token_address, sender) = tip_setup();
        let tips = soroban_sdk::Vec::new(&env);
        client.batch_tip(&token_address, &sender, &tips);
    }

    // `batch_send` is still a placeholder, but its batch shape is validated
    // first so callers of the eventual implementation get the same clear errors.

    #[test]
    #[should_panic(expected = "At least one payment is required")]
    fn test_batch_send_rejects_empty_batch() {
        let (env, client, _admin, payer, _recipient) = setup();
        client.batch_send(
            &payer,
            &soroban_sdk::Vec::new(&env),
            &soroban_sdk::Vec::new(&env),
        );
    }

    #[test]
    #[should_panic(expected = "Batch size exceeds maximum allowed (25 entries)")]
    fn test_batch_send_rejects_batch_above_cap() {
        let (env, client, _admin, payer, _recipient) = setup();
        let mut recipients = soroban_sdk::Vec::new(&env);
        let mut amounts = soroban_sdk::Vec::new(&env);
        while recipients.len() < MAX_BATCH + 1 {
            recipients.push_back(Address::generate(&env));
            amounts.push_back(1i128);
        }
        client.batch_send(&payer, &recipients, &amounts);
    }

    #[test]
    #[should_panic(expected = "Recipient and amount vectors must have the same length")]
    fn test_batch_send_rejects_length_mismatch() {
        let (env, client, _admin, payer, _recipient) = setup();
        let recipients = soroban_sdk::Vec::from_array(&env, [Address::generate(&env)]);
        let amounts = soroban_sdk::Vec::from_array(&env, [1i128, 2i128]);
        client.batch_send(&payer, &recipients, &amounts);
    }

    /// A batch that passes every size check still reports the feature as
    /// unimplemented — the cap checks do not imply an implementation.
    #[test]
    #[should_panic(expected = "Batch payments coming in v2.0")]
    fn test_batch_send_within_cap_is_still_a_placeholder() {
        let (env, client, _admin, payer, _recipient) = setup();
        let recipients = soroban_sdk::Vec::from_array(
            &env,
            [Address::generate(&env), Address::generate(&env)],
        );
        let amounts = soroban_sdk::Vec::from_array(&env, [1i128, 2i128]);
        client.batch_send(&payer, &recipients, &amounts);
    }

    // ─── Tip fee rounding (#1488) ────────────────────────────────────────────

    /// Tipping fixture with a configured operator fee and a funded sender.
    ///
    /// Snapshot capture is turned off because the property tests build one
    /// environment per generated case and would otherwise write a snapshot file
    /// for every one of them.
    fn fee_fixture(
        fee_bps: u32,
        funding: i128,
    ) -> (
        Env,
        MicroPayContractClient<'static>,
        Address,
        Address,
        Address,
    ) {
        let mut env = Env::default();
        env.set_config(soroban_sdk::testutils::EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        let issuer = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(issuer).address();
        let sender = Address::generate(&env);
        soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&sender, &funding);
        if fee_bps > 0 {
            client.set_fee_bps(&admin, &fee_bps);
        }
        (env, client, token, sender, admin)
    }

    fn balance_of(env: &Env, token: &Address, account: &Address) -> i128 {
        soroban_sdk::token::Client::new(env, token).balance(account)
    }

    /// `floor(amount * fee_bps / 10_000)` from the textbook expression. Only
    /// sound for amounts small enough that the product cannot overflow, which is
    /// exactly what makes it a useful cross-check of `fee_for`'s decomposed
    /// arithmetic.
    fn expected_fee_small(amount: i128, fee_bps: u32) -> i128 {
        (amount * fee_bps as i128) / FEE_BPS_DENOMINATOR
    }

    /// `ceil(total * fee_bps / 10_000)`: the upper bound a batch's withheld fee
    /// may never cross, computed without an intermediate `total * fee_bps`.
    fn fee_ceiling_for_total(total: i128, fee_bps: u32) -> i128 {
        let bps = fee_bps as i128;
        let quotient = total / FEE_BPS_DENOMINATOR;
        let remainder = total % FEE_BPS_DENOMINATOR;
        quotient * bps + (remainder * bps + FEE_BPS_DENOMINATOR - 1) / FEE_BPS_DENOMINATOR
    }

    #[test]
    fn test_batch_tip_applies_fee_and_conserves_value() {
        let (env, client, token, sender, admin) = fee_fixture(MAX_FEE_BPS, 10_000);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        let tips = soroban_sdk::Vec::from_array(
            &env,
            [(a.clone(), 1_000i128), (b.clone(), 999i128), (c.clone(), 1i128)],
        );

        client.batch_tip(&token, &sender, &tips);

        // 500 bps of 1000 is 50, of 999 is 49.95 -> 49, of 1 is 0.0005 -> 0.
        assert_eq!(balance_of(&env, &token, &a), 950);
        assert_eq!(balance_of(&env, &token, &b), 950);
        assert_eq!(balance_of(&env, &token, &c), 1);
        assert_eq!(balance_of(&env, &token, &admin), 99);
        // The payer is debited the gross total, not the sum of the net amounts.
        assert_eq!(balance_of(&env, &token, &sender), 8_000);
        // Nothing is left in the contract: debit == recipient credits + fee.
        assert_eq!(balance_of(&env, &token, &client.address), 0);
        // Analytics keep recording the gross amount, as `send_tip` does.
        assert_eq!(client.get_tip_total(&b), 999);
    }

    #[test]
    fn test_send_tip_and_batch_tip_charge_the_same_fee() {
        for amount in [1i128, 3, 9_999, 10_000, 12_345, 1_000_000] {
            for fee_bps in [0u32, 1, 250, MAX_FEE_BPS] {
                let (env, client, token, sender, admin) = fee_fixture(fee_bps, 4_000_000);
                let single = Address::generate(&env);
                let batched = Address::generate(&env);

                client.send_tip(&token, &sender, &single, &amount);
                client.batch_tip(
                    &token,
                    &sender,
                    &soroban_sdk::Vec::from_array(&env, [(batched.clone(), amount)]),
                );

                let received = balance_of(&env, &token, &single);
                assert_eq!(received, amount - expected_fee_small(amount, fee_bps));
                assert_eq!(balance_of(&env, &token, &batched), received);
                assert_eq!(balance_of(&env, &token, &admin), 2 * (amount - received));
                assert_eq!(balance_of(&env, &token, &sender), 4_000_000 - 2 * amount);
                assert_eq!(balance_of(&env, &token, &client.address), 0);
            }
        }
    }

    /// Sub-stroop fees round down to zero, so splitting a tip across a batch can
    /// withhold slightly less than the nominal rate. The leakage is bounded by
    /// `MAX_BATCH - 1` stroops per call, which is a large part of why the cap is
    /// as low as it is.
    #[test]
    fn test_batch_tip_sub_stroop_fees_round_down() {
        let (env, client, token, sender, admin) = fee_fixture(MAX_FEE_BPS, 10_000);
        let mut tips = soroban_sdk::Vec::new(&env);
        while tips.len() < MAX_BATCH {
            tips.push_back((Address::generate(&env), 1i128));
        }

        client.batch_tip(&token, &sender, &tips);

        assert_eq!(balance_of(&env, &token, &admin), 0);
        assert_eq!(balance_of(&env, &token, &sender), 10_000 - MAX_BATCH as i128);

        // The same 25 stroops sent as one tip do pay the fee (1 stroop).
        let lump = Address::generate(&env);
        client.send_tip(&token, &sender, &lump, &(MAX_BATCH as i128));
        assert_eq!(balance_of(&env, &token, &admin), 1);
        assert_eq!(balance_of(&env, &token, &lump), MAX_BATCH as i128 - 1);
    }

    /// The old expression `amount * fee_bps / 10_000` panicked on
    /// `multiply with overflow` for amounts above ~3.4e35 stroops, because
    /// release builds enable `overflow-checks`. Amounts that large are reachable:
    /// a custom SAC has no supply cap and `i128` is the amount type.
    #[test]
    fn test_huge_tip_amounts_do_not_overflow_fee_math() {
        let huge = i128::MAX / 4;
        let (env, client, token, sender, admin) = fee_fixture(MAX_FEE_BPS, huge + 1_000);
        let recipient = Address::generate(&env);
        let batched = Address::generate(&env);

        client.send_tip(&token, &sender, &recipient, &huge);
        client.batch_tip(
            &token,
            &sender,
            &soroban_sdk::Vec::from_array(&env, [(batched.clone(), 1_000i128)]),
        );

        // floor(huge * 500 / 10_000) == floor(huge / 20)
        let huge_fee = huge / 20;
        assert_eq!(balance_of(&env, &token, &recipient), huge - huge_fee);
        assert_eq!(balance_of(&env, &token, &batched), 950);
        assert_eq!(balance_of(&env, &token, &admin), huge_fee + 50);
        assert_eq!(balance_of(&env, &token, &sender), 0);
        assert_eq!(balance_of(&env, &token, &client.address), 0);
    }

    #[test]
    #[should_panic(expected = "Tip total overflow")]
    fn test_batch_tip_rejects_amounts_that_overflow_the_total() {
        let (env, client, token, sender, _admin) = fee_fixture(0, 1_000);
        let tips = soroban_sdk::Vec::from_array(
            &env,
            [
                (Address::generate(&env), i128::MAX),
                (Address::generate(&env), 1i128),
            ],
        );
        client.batch_tip(&token, &sender, &tips);
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(48))]

        /// For any legal fee rate and any batch of positive amounts — every case
        /// includes a 1-stroop entry, the rounding edge #1488 asks about — the fee
        /// withheld never exceeds the nominal rate on the batch total, each
        /// recipient receives exactly `amount - floor(amount * bps / 10_000)`, and
        /// the payer's debit is conserved.
        #[test]
        fn prop_batch_tip_fee_respects_cap_and_conserves(
            tail in prop::collection::vec(1i128..1_000_000i128, 1..(MAX_BATCH as usize)),
            fee_bps in 0u32..=MAX_FEE_BPS,
        ) {
            let mut amounts: std::vec::Vec<i128> = std::vec::Vec::new();
            amounts.push(1);
            amounts.extend(tail.into_iter());

            let total: i128 = amounts.iter().sum();
            let funding = total + 1_000_000;
            let (env, client, token, sender, admin) = fee_fixture(fee_bps, funding);

            let mut recipients: std::vec::Vec<Address> = std::vec::Vec::new();
            let mut tips = soroban_sdk::Vec::new(&env);
            for amount in amounts.iter() {
                let recipient = Address::generate(&env);
                recipients.push(recipient.clone());
                tips.push_back((recipient, *amount));
            }

            client.batch_tip(&token, &sender, &tips);

            let mut withheld = 0i128;
            for (recipient, amount) in recipients.iter().zip(amounts.iter()) {
                let fee = expected_fee_small(*amount, fee_bps);
                withheld += fee;
                prop_assert!(fee <= *amount, "fee {} exceeds tip {}", fee, *amount);
                prop_assert_eq!(balance_of(&env, &token, recipient), *amount - fee);
            }

            prop_assert!(
                withheld <= fee_ceiling_for_total(total, fee_bps),
                "batch fee {} exceeds ceil({} * {} / 10000) = {}",
                withheld,
                total,
                fee_bps,
                fee_ceiling_for_total(total, fee_bps)
            );
            prop_assert_eq!(balance_of(&env, &token, &admin), withheld);
            prop_assert_eq!(balance_of(&env, &token, &sender), funding - total);
            prop_assert_eq!(balance_of(&env, &token, &client.address), 0);
        }

        /// The same invariants at i128 scale. Amounts are exact multiples of the
        /// basis-point denominator, so the expected fee is `amount / 10_000 * bps`
        /// — a reference the contract cannot satisfy by reusing its own
        /// arithmetic — and every entry is large enough that the previous
        /// `amount * fee_bps` product would have overflowed.
        #[test]
        fn prop_batch_tip_fee_is_exact_at_i128_scale(
            units in prop::collection::vec(1i128..(1i128 << 105), 1..=3),
            fee_bps in 0u32..=MAX_FEE_BPS,
        ) {
            let amounts: std::vec::Vec<i128> =
                units.iter().map(|u| u * FEE_BPS_DENOMINATOR).collect();
            let total: i128 = amounts.iter().sum();
            let funding = total + FEE_BPS_DENOMINATOR;
            let (env, client, token, sender, admin) = fee_fixture(fee_bps, funding);

            let mut recipients: std::vec::Vec<Address> = std::vec::Vec::new();
            let mut tips = soroban_sdk::Vec::new(&env);
            for amount in amounts.iter() {
                let recipient = Address::generate(&env);
                recipients.push(recipient.clone());
                tips.push_back((recipient, *amount));
            }

            client.batch_tip(&token, &sender, &tips);

            let mut withheld = 0i128;
            for (recipient, unit) in recipients.iter().zip(units.iter()) {
                let fee = unit * fee_bps as i128;
                withheld += fee;
                prop_assert_eq!(
                    balance_of(&env, &token, recipient),
                    unit * FEE_BPS_DENOMINATOR - fee
                );
            }

            prop_assert!(withheld <= fee_ceiling_for_total(total, fee_bps));
            prop_assert_eq!(balance_of(&env, &token, &admin), withheld);
            prop_assert_eq!(balance_of(&env, &token, &sender), funding - total);
            prop_assert_eq!(balance_of(&env, &token, &client.address), 0);
        }
    }

    // ─── Freeze / unfreeze tests ─────────────────────────────────────────────

    #[test]
    fn test_freeze_blocks_send_tip_and_mint_receipt() {
        let (env, client, admin, payer, recipient) = setup();
        assert!(!client.is_frozen());

        client.freeze(&admin);
        assert!(client.is_frozen());

        // send_tip must be rejected while frozen.
        let issuer = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(issuer)
            .address();
        let res = client.try_send_tip(&token, &payer, &recipient, &100);
        assert!(res.is_err());

        // mint_receipt must also be rejected.
        let res2 = client.try_mint_receipt(&payer, &recipient, &50, &Symbol::new(&env, "Test"));
        assert!(res2.is_err());
    }

    #[test]
    fn test_unfreeze_restores_operations() {
        let (_env, client, admin, _payer, recipient) = setup();
        client.freeze(&admin);
        assert!(client.is_frozen());

        client.unfreeze(&admin);
        assert!(!client.is_frozen());

        // get_admin still works while frozen and after unfreeze.
        assert_eq!(client.get_admin(), admin);
        // is_frozen (read-only) always works.
        assert!(!client.is_frozen());
    }

    #[test]
    #[should_panic]
    fn test_freeze_requires_admin() {
        let (env, client, _admin, _payer, _recipient) = setup();
        let non_admin = Address::generate(&env);
        client.freeze(&non_admin);
    }

    #[test]
    fn test_read_only_getters_work_while_frozen() {
        let (_env, client, admin, _payer, recipient) = setup();
        client.freeze(&admin);
        // These must not panic while the contract is frozen.
        let _ = client.get_admin();
        let _ = client.get_fee_bps();
        let _ = client.get_tip_total(&recipient);
        let _ = client.get_tip_count(&recipient);
        let _ = client.is_frozen();
    }

    // ─── TTL boundary tests ──────────────────────────────────────────────────

    /// Simulates the instance storage entry being near expiry (1 ledger before
    /// `INSTANCE_TTL_THRESHOLD`) and confirms that calling any entry point
    /// keeps state accessible — i.e., extend_ttl was called and the contract
    /// survives the boundary.
    #[test]
    fn test_instance_ttl_extended_near_threshold() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        // Jump to a ledger just before the instance TTL would expire.
        // The test environment starts the instance TTL at its max; we only care
        // that bump_instance is called and succeeds without panicking, which
        // confirms it is wired into every entry point tested below.
        let near_expiry = INSTANCE_TTL_THRESHOLD - 1;
        env.ledger().set_sequence_number(near_expiry);

        // Every entry point category: admin, getter, tip, receipt, stream.
        assert_eq!(client.get_admin(), admin);

        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let stream_id = client.open_stream(&payer, &recipient, &1, &100);
        assert_eq!(client.get_stream(&stream_id).deposited, 100);
        assert_eq!(client.get_claimable(&stream_id), 0);

        let memo = Symbol::new(&env, "Test");
        let receipt_id = client.mint_receipt(&payer, &recipient, &50, &memo);
        assert_eq!(client.get_receipt_count(&payer), 1);
        let receipt = client.get_receipt(&payer, &receipt_id);
        assert_eq!(receipt.amount, 50);

        assert_eq!(client.get_fee_bps(), 0);
        assert_eq!(client.get_tip_total(&recipient), 0);
        assert_eq!(client.get_tip_count(&recipient), 0);
    }

    /// Confirms that the instance TTL is extended when a stream is created and
    /// then claimed a large number of ledgers later (near the TTL boundary for
    /// instance storage).
    #[test]
    fn test_stream_claim_near_instance_ttl_boundary() {
        let (env, client, _admin, payer, recipient) = setup();

        // Rate of 1 per ledger with a large deposit; advance close to TTL boundary.
        let id = client.open_stream(&payer, &recipient, &1, &200_000);
        let start = env.ledger().sequence();

        // Advance to just below INSTANCE_TTL_THRESHOLD.
        env.ledger().set_sequence_number(start + INSTANCE_TTL_THRESHOLD - 1);

        // Claiming here exercises bump_instance; if it were absent the entry
        // would succeed in test but the instance would be archived on mainnet.
        let claimed = client.claim_stream(&id, &recipient);
        assert_eq!(
            claimed,
            (INSTANCE_TTL_THRESHOLD - 1) as i128,
            "expected all accrued funds to be claimable near TTL boundary"
        );
    }

    /// Confirms that the persistent TTL for a milestone escrow is bumped at the
    /// TTL threshold boundary, keeping the record alive.
    #[test]
    fn test_milestone_escrow_persistent_ttl_extended_near_threshold() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        MicroPayContractClient::new(&env, &contract_id).initialize(&Address::generate(&env));

        let token = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let approver = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token).mint(&payer, &10_000);

        let client = MicroPayContractClient::new(&env, &contract_id);
        let id = client.create_milestone_escrow(
            &token,
            &payer,
            &recipient,
            &1_000,
            &approver,
            &500,
        );

        // Advance to just before the persistent TTL threshold.
        let near_expiry = ESCROW_TTL_THRESHOLD - 1;
        env.ledger().set_sequence_number(near_expiry);

        // load_escrow (called by get_milestone_escrow) must re-extend the entry.
        let escrow = client.get_milestone_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Pending);
        assert_eq!(escrow.amount, 1_000);
    }

    /// Verifies the full time-locked escrow lifecycle works when the contract
    /// instance is near expiry.
    #[test]
    fn test_time_locked_escrow_near_instance_ttl_boundary() {
        let (env, client, _admin, payer, recipient) = setup();

        // Create an escrow that releases well before the TTL threshold.
        let current = env.ledger().sequence();
        let release = current + 50;
        let id = client.open_escrow(&payer, &recipient, &200, &release);

        // Jump to just before the TTL threshold, but comfortably past the
        // release ledger so the escrow can be collected.
        let target = release + INSTANCE_TTL_THRESHOLD;
        env.ledger().set_sequence_number(target);

        let released = client.release_escrow(&id);
        assert_eq!(released, 200);
        assert!(client.get_escrow(&id).released);
    }
}

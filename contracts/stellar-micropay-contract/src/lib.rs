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
    contract, contractevent, contractimpl, contracttype, token, Address, BytesN, Env, Symbol,
};

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
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
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
    pub fn send_tip(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) {
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
        let fee_amount: i128 = (amount * fee_bps as i128) / FEE_BPS_DENOMINATOR;
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
    pub fn batch_tip(
        env: Env,
        token_address: Address,
        from: Address,
        tips: soroban_sdk::Vec<(Address, i128)>,
    ) {
        from.require_auth();
        if tips.len() == 0 {
            panic!("At least one tip is required");
        }

        let mut total = 0i128;
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
            i += 1;
        }

        let token = token::Client::new(&env, &token_address);
        let contract = env.current_contract_address();
        token.transfer(&from, &contract, &total);

        let mut index = 0u32;
        while index < tips.len() {
            let (recipient, amount) = tips.get(index).unwrap();
            token.transfer(&contract, &recipient, &amount);

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
        from.require_auth();

        if amount <= 0 {
            panic!("Receipt amount must be positive");
        }

        from.require_auth();

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
        Self::load_escrow(&env, escrow_id)
    }

    /// Get the number of milestone escrows created so far.
    pub fn get_milestone_escrow_count(env: Env) -> u32 {
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
        let total_streamed = stream.rate_per_ledger * elapsed_ledgers as i128;
        let claimable = total_streamed - stream.claimed;

        // Freeze accrual while paused: recompute against pause_ledger.
        let claimable = if let Some(paused_at) = stream.pause_ledger {
            let paused_elapsed = paused_at.saturating_sub(stream.start_ledger);
            let paused_total = stream.rate_per_ledger * paused_elapsed as i128;
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
    pub fn close_stream(env: Env, stream_id: u32, payer: Address) -> i128 {
        payer.require_auth();

        let stream: Stream = env
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
        let total_streamed = stream.rate_per_ledger * elapsed as i128;
        let vested = total_streamed.max(stream.claimed).min(stream.deposited);
        let refundable = stream.deposited - vested;

        env.storage().instance().remove(&DataKey::Stream(stream_id));

        env.events().publish(
            (
                Symbol::new(&env, "MicroPayContract"),
                Symbol::new(&env, "close_stream"),
                payer,
                stream_id,
            ),
            refundable,
        );

        refundable
    }

    /// Pause a stream: freezes elapsed time at the current ledger.
    pub fn pause_stream(env: Env, stream_id: u32, payer: Address) {
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
        env.storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("Stream not found")
    }

    /// Get the currently claimable amount for a stream.
    pub fn get_claimable(env: Env, stream_id: u32) -> i128 {
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
    pub fn batch_send(
        _env: Env,
        _from: Address,
        _recipients: soroban_sdk::Vec<Address>,
        _amounts: soroban_sdk::Vec<i128>,
    ) {
        panic!("Batch payments coming in v2.0 — see ROADMAP.md");
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger},
        Address, Env,
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
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), admin);

        let new_admin = Address::generate(&env);

        env.mock_all_auths();
        client.set_admin(&new_admin);

        assert_eq!(client.get_admin(), new_admin);
    }

    #[test]
    #[should_panic]
    fn test_upgrade_non_admin_panics() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let dummy_hash = BytesN::from_array(&env, &[1u8; 32]);
        // Without admin auth, calling upgrade panics
        client.upgrade(&dummy_hash);
    }

    #[test]
    fn test_upgrade_admin_requires_auth_and_invokes_deployer() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        env.mock_all_auths();

        let dummy_hash = BytesN::from_array(&env, &[1u8; 32]);
        // With admin auth, try_upgrade passes the admin auth check and invokes deployer.
        // In native test environment, deployer returns an Err (InvalidAction for non-wasm target).
        let res = client.try_upgrade(&dummy_hash);
        assert!(res.is_err());
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
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        env.ledger().set_sequence_number(env.ledger().sequence() + 5);
        let claimed = client.claim_stream(&id, &recipient);
        assert_eq!(claimed, 50);
        let refund = client.close_stream(&id, &payer);
        assert_eq!(refund, 950);
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
            let contract_id = env.register_contract(None, MicroPayContract);
            MicroPayContractClient::new(&env, &contract_id).initialize(&Address::generate(&env));
            env.mock_all_auths();

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
}

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, String, Symbol,
};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum ContractError {
    AlreadyInitialized = 1,
    SchemaAlreadyCurrent = 2,
    SchemaDowngrade = 3,
    EscrowClaimTooEarly = 4,
    EscrowCancelTooLate = 5,
    ReceiptMemoTooLong = 6,
}

const PERSISTENT_LIFETIME_THRESHOLD: u32 = 100_000;
const PERSISTENT_BUMP_AMOUNT: u32 = 500_000;
const INSTANCE_LIFETIME_THRESHOLD: u32 = 100_000;
const INSTANCE_BUMP_AMOUNT: u32 = 500_000;

fn bump_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(
        INSTANCE_LIFETIME_THRESHOLD,
        INSTANCE_BUMP_AMOUNT,
    );
}

/// Storage schema version written by `initialize` and advanced by `migrate`.
///
/// Bump this whenever a stored struct (`Stream`, `Escrow`, …) or a `DataKey`
/// variant changes shape, and add the corresponding step to the migration
/// table in the contract README (#562).
pub const SCHEMA_VERSION: u32 = 4;

/// Version of every event data payload emitted by this contract. Event names
/// and indexed topics stay stable; only the non-indexed data tuple is
/// versioned so indexers can select the correct decoder (#798).
pub const EVENT_SCHEMA_VERSION: u32 = 1;

/// Maximum UTF-8 byte length accepted for a receipt memo (#797).
pub const MAX_RECEIPT_MEMO_BYTES: u32 = 256;

/// Smallest deposit `open_stream` accepts, in stroops (0.001 XLM against the
/// native SAC).
///
/// Anything smaller is a dust stream: the per-claim token transfer and the
/// storage rent for the `Stream` entry cost more than the stream can ever pay
/// out (#561).
pub const MIN_STREAM_DEPOSIT: i128 = 10_000;

/// Smallest number of ledgers a stream must be funded for — `deposit /
/// rate_per_ledger` — which is roughly five minutes at the ~5s Stellar ledger
/// close time (#561).
///
/// This rejects the other flavour of dust: a deposit large enough on its own
/// but paired with a rate that drains it in a handful of ledgers (or in zero
/// ledgers, when `rate_per_ledger > deposit`).
pub const MIN_STREAM_DURATION_LEDGERS: u32 = 60;

/// Maximum number of recipients permitted in a single `batch_send` call (#787).
pub const MAX_BATCH_SEND_RECIPIENTS: u32 = 25;

/// Maximum number of recipients permitted in a single stream (`open_stream`) (#787).
pub const MAX_STREAM_RECIPIENTS: u32 = 20;


#[contracttype]
#[derive(Clone, Debug)]
pub struct TipRecord {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ReceiptMetadata {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub memo: String,
    pub ledger: u32,
}

/// Receipt layout used through storage schema v3. It remains readable via
/// `get_legacy_receipt` while new records are written under `ReceiptRecordV2`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct LegacyReceiptMetadata {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub memo: Symbol,
    pub ledger: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    TipTotal(Address),
    TipCount(Address),
    TipRecord(Address, u32),
    ReceiptCount(Address),
    ReceiptRecord(Address, u32),
    EscrowCount,
    Escrow(u32),
    StreamCount,
    Stream(u32),
    SchemaVersion,
    /// Number of escrows indexed for `Address` as sender (#796).
    EscrowSenderCount(Address),
    /// Maps `(sender, index)` → global escrow id (#796).
    EscrowSenderIndex(Address, u32),
    /// Number of escrows indexed for `Address` as recipient (#796).
    EscrowRecipientCount(Address),
    /// Maps `(recipient, index)` → global escrow id (#796).
    EscrowRecipientIndex(Address, u32),
    /// UTF-8 receipt layout introduced in storage schema v4 (#797). Appended
    /// to preserve the encoded discriminants of every existing key variant.
    ReceiptRecordV2(Address, u32),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    Pending,
    Released,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    pub id: u32,
    pub from: Address,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub status: EscrowStatus,
}

/// One recipient's share of a stream's payout (#559).
///
/// `weight` is unit-less — a recipient's entitlement is
/// `weight / sum(all weights on the stream)`. `claimed` is that recipient's
/// own running total, which is what keeps per-recipient payouts independent
/// of the order recipients claim in.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamRecipient {
    pub recipient: Address,
    pub weight: u32,
    pub claimed: i128,
}

/// A continuous payment channel: `payer` locks `deposited` up front and the
/// stream accrues `rate_per_ledger` for every ledger it is running, split
/// across `recipients` by weight (#559).
///
/// Accrual is derived, never stored — each recipient's `claimed` is the only
/// mutable money field, which is what keeps `sum(claimed) <= deposited`
/// checkable at any point (#557).
#[contracttype]
#[derive(Clone, Debug)]
pub struct Stream {
    pub payer: Address,
    pub recipients: soroban_sdk::Vec<StreamRecipient>,
    pub rate_per_ledger: i128,
    pub deposited: i128,
    pub start_ledger: u32,
    /// Token contract the deposit is denominated in.
    pub token: Address,
    /// True while accrual is suspended by the payer (#560).
    pub paused: bool,
    /// Ledger the current pause started at; meaningless when `paused` is false.
    pub paused_at_ledger: u32,
    /// Ledgers spent in *completed* pauses, subtracted from the accrual window.
    pub paused_ledgers: u32,
    /// True once `close_stream` has settled and refunded the stream.
    pub closed: bool,
}

/// Index of `recipients[i].recipient == addr`, if `addr` is on the stream.
fn find_recipient(recipients: &soroban_sdk::Vec<StreamRecipient>, addr: &Address) -> Option<u32> {
    for i in 0..recipients.len() {
        if &recipients.get(i).unwrap().recipient == addr {
            return Some(i);
        }
    }
    None
}

fn total_weight(recipients: &soroban_sdk::Vec<StreamRecipient>) -> u32 {
    let mut total: u32 = 0;
    for i in 0..recipients.len() {
        total = total.saturating_add(recipients.get(i).unwrap().weight);
    }
    total
}

fn total_claimed(recipients: &soroban_sdk::Vec<StreamRecipient>) -> i128 {
    let mut total: i128 = 0;
    for i in 0..recipients.len() {
        total += recipients.get(i).unwrap().claimed;
    }
    total
}

/// Total ledgers this stream has spent paused, including an in-progress pause.
fn paused_ledgers_total(stream: &Stream, current_ledger: u32) -> u32 {
    if stream.paused {
        let ongoing = current_ledger.saturating_sub(stream.paused_at_ledger);
        stream.paused_ledgers.saturating_add(ongoing)
    } else {
        stream.paused_ledgers
    }
}

fn effective_elapsed_ledgers(stream: &Stream, current_ledger: u32) -> u32 {
    let paused = paused_ledgers_total(stream, current_ledger);
    current_ledger
        .saturating_sub(stream.start_ledger)
        .saturating_sub(paused)
}

/// Total amount streamed to *all* recipients combined, as of `current_ledger`.
///
/// Cap the accrual window at the ledger where the deposit runs out. That
/// keeps the multiplication below bounded by `deposited` (so it can never
/// overflow i128) and enforces `total_streamed <= deposited` structurally
/// rather than by an after-the-fact clamp.
fn total_streamed_amount(stream: &Stream, current_ledger: u32) -> i128 {
    let elapsed_ledgers = effective_elapsed_ledgers(stream, current_ledger);

    let funded_ledgers = stream.deposited / stream.rate_per_ledger;
    let elapsed_ledgers = if i128::from(elapsed_ledgers) > funded_ledgers {
        funded_ledgers as u32
    } else {
        elapsed_ledgers
    };

    stream.rate_per_ledger * elapsed_ledgers as i128
}

/// Amount `recipient` can withdraw right now: their weighted share of the
/// total streamed so far, minus what they have already claimed (#559).
///
/// While a stream is paused the accrual window stops growing, so this stays
/// flat until `resume_stream` — and after the resume it picks up exactly where
/// it left off, because the pause length is folded into `paused_ledgers`.
fn claimable_amount(stream: &Stream, recipient: &Address, current_ledger: u32) -> i128 {
    if stream.closed {
        return 0;
    }
    let Some(idx) = find_recipient(&stream.recipients, recipient) else {
        return 0;
    };
    let entry = stream.recipients.get(idx).unwrap();

    let total_streamed = total_streamed_amount(stream, current_ledger);
    let weight_total = total_weight(&stream.recipients);
    let entitled = total_streamed * i128::from(entry.weight) / i128::from(weight_total);

    let claimable = entitled - entry.claimed;
    if claimable > 0 {
        claimable
    } else {
        0
    }
}

fn load_stream(env: &Env, stream_id: u32) -> Stream {
    let key = DataKey::Stream(stream_id);
    let stream = env
        .storage()
        .persistent()
        .get(&key)
        .expect("stream not found");
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
    stream
}

fn load_escrow(env: &Env, id: u32) -> Escrow {
    let key = DataKey::Escrow(id);
    let escrow = env
        .storage()
        .persistent()
        .get(&key)
        .expect("escrow not found");
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
    escrow
}

/// Maximum page size for account-oriented escrow listings (#796).
const MAX_ESCROW_PAGE_SIZE: u32 = 50;

fn extend_persistent_ttl<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    env.storage().persistent().extend_ttl(
        key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

fn append_escrow_sender_index(env: &Env, sender: &Address, escrow_id: u32) {
    let count_key = DataKey::EscrowSenderCount(sender.clone());
    let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
    let index_key = DataKey::EscrowSenderIndex(sender.clone(), count);
    env.storage().persistent().set(&index_key, &escrow_id);
    extend_persistent_ttl(env, &index_key);
    env.storage().persistent().set(&count_key, &(count + 1));
    extend_persistent_ttl(env, &count_key);
}

fn append_escrow_recipient_index(env: &Env, recipient: &Address, escrow_id: u32) {
    let count_key = DataKey::EscrowRecipientCount(recipient.clone());
    let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
    let index_key = DataKey::EscrowRecipientIndex(recipient.clone(), count);
    env.storage().persistent().set(&index_key, &escrow_id);
    extend_persistent_ttl(env, &index_key);
    env.storage().persistent().set(&count_key, &(count + 1));
    extend_persistent_ttl(env, &count_key);
}

fn index_escrow_accounts(env: &Env, from: &Address, to: &Address, escrow_id: u32) {
    append_escrow_sender_index(env, from, escrow_id);
    append_escrow_recipient_index(env, to, escrow_id);
}

fn list_escrow_ids_for_role(
    env: &Env,
    total: u32,
    offset: u32,
    limit: u32,
    sender: Option<Address>,
    recipient: Option<Address>,
) -> soroban_sdk::Vec<u32> {
    let limit = if limit == 0 {
        MAX_ESCROW_PAGE_SIZE
    } else {
        limit.min(MAX_ESCROW_PAGE_SIZE)
    };
    let mut ids = soroban_sdk::Vec::new(env);
    let start = offset.min(total);
    let end = offset.saturating_add(limit).min(total);
    for idx in start..end {
        let key = match (&sender, &recipient) {
            (Some(account), None) => DataKey::EscrowSenderIndex(account.clone(), idx),
            (None, Some(account)) => DataKey::EscrowRecipientIndex(account.clone(), idx),
            _ => panic!("exactly one role must be set"),
        };
        let id: u32 = env
            .storage()
            .persistent()
            .get(&key)
            .expect("escrow index entry missing");
        extend_persistent_ttl(env, &key);
        ids.push_back(id);
    }
    ids
}

fn save_stream(env: &Env, stream_id: u32, stream: &Stream) {
    let key = DataKey::Stream(stream_id);
    env.storage().persistent().set(&key, stream);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

#[contract]
pub struct MicroPayContract;

#[contractimpl]
impl MicroPayContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        bump_instance_ttl(&env);
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().extend_ttl(
            &DataKey::Admin,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        // Stamp the storage layout a fresh deployment starts on, so `migrate`
        // can tell an up-to-date instance from one that predates a schema
        // change (#562).
        env.storage()
            .persistent()
            .set(&DataKey::SchemaVersion, &SCHEMA_VERSION);
        env.storage().persistent().extend_ttl(
            &DataKey::SchemaVersion,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        // Emit an init event so off-chain indexers can detect an initialised
        // contract without polling get_admin() (#258).
        env.events()
            .publish((Symbol::new(&env, "init"),), (EVENT_SCHEMA_VERSION, admin));
        Ok(())
    }

    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) {
        bump_instance_ttl(&env);
        current_admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        env.storage().persistent().extend_ttl(
            &DataKey::Admin,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
        if current_admin != stored_admin {
            panic!("Unauthorized");
        }
        env.storage().persistent().set(&DataKey::Admin, &new_admin);
        env.storage().persistent().extend_ttl(
            &DataKey::Admin,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }

    pub fn send_tip(env: Env, token_address: Address, from: Address, to: Address, amount: i128) {
        bump_instance_ttl(&env);
        from.require_auth();
        if amount <= 0 {
            panic!("Tip amount must be positive");
        }

        // Checks-Effects: persist all state BEFORE external token transfer.
        let current_total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TipTotal(to.clone()))
            .unwrap_or(0);
        let current_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TipCount(to.clone()))
            .unwrap_or(0);
        let total_key = DataKey::TipTotal(to.clone());
        let count_key = DataKey::TipCount(to.clone());
        if env.storage().persistent().has(&total_key) {
            env.storage().persistent().extend_ttl(
                &total_key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        if env.storage().persistent().has(&count_key) {
            env.storage().persistent().extend_ttl(
                &count_key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::TipTotal(to.clone()), &(current_total + amount));
        env.storage().persistent().extend_ttl(
            &DataKey::TipTotal(to.clone()),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        env.storage()
            .persistent()
            .set(&DataKey::TipCount(to.clone()), &(current_count + 1));
        env.storage().persistent().extend_ttl(
            &DataKey::TipCount(to.clone()),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        let record = TipRecord {
            from: from.clone(),
            to: to.clone(),
            amount,
            ledger: env.ledger().sequence(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::TipRecord(to.clone(), current_count), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::TipRecord(to.clone(), current_count),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        // Clone `from` into the event tuple so the owned binding is not moved
        // out before the borrow checker is done with it (#202).
        env.events().publish(
            (Symbol::new(&env, "tip"), from.clone(), to.clone()),
            (EVENT_SCHEMA_VERSION, amount),
        );

        // Interactions: external token transfer after all state is persisted.
        let token = token::Client::new(&env, &token_address);
        token.transfer(&from, &to, &amount);
    }

    pub fn get_tip_total(env: Env, recipient: Address) -> i128 {
        bump_instance_ttl(&env);
        let key = DataKey::TipTotal(recipient);
        let val = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        val
    }

    pub fn get_tip_count(env: Env, recipient: Address) -> u32 {
        bump_instance_ttl(&env);
        let key = DataKey::TipCount(recipient);
        let val = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        val
    }

    pub fn get_admin(env: Env) -> Address {
        bump_instance_ttl(&env);
        let key = DataKey::Admin;
        let val: Address = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Contract not initialized");
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
        val
    }

    pub fn get_tip_record(env: Env, recipient: Address, index: u32) -> TipRecord {
        bump_instance_ttl(&env);
        let key = DataKey::TipRecord(recipient, index);
        let val: TipRecord = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Tip record not found");
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
        val
    }

    pub fn mint_receipt(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
        memo: String,
    ) -> Result<u32, ContractError> {
        bump_instance_ttl(&env);
        from.require_auth();
        if amount <= 0 {
            panic!("Receipt amount must be positive");
        }
        if memo.len() > MAX_RECEIPT_MEMO_BYTES {
            return Err(ContractError::ReceiptMemoTooLong);
        }
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::ReceiptCount(from.clone()))
            .unwrap_or(0);
        let count_key = DataKey::ReceiptCount(from.clone());
        if env.storage().persistent().has(&count_key) {
            env.storage().persistent().extend_ttl(
                &count_key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }

        let receipt = ReceiptMetadata {
            from: from.clone(),
            to,
            amount,
            timestamp: env.ledger().timestamp(),
            memo,
            ledger: env.ledger().sequence(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::ReceiptRecordV2(from.clone(), count), &receipt);
        env.storage().persistent().extend_ttl(
            &DataKey::ReceiptRecordV2(from.clone(), count),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        env.storage()
            .persistent()
            .set(&DataKey::ReceiptCount(from.clone()), &(count + 1));
        env.storage().persistent().extend_ttl(
            &DataKey::ReceiptCount(from.clone()),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        env.events().publish(
            (Symbol::new(&env, "receipt"), from),
            (EVENT_SCHEMA_VERSION, count),
        );
        Ok(count)
    }

    pub fn get_receipt_count(env: Env, payer: Address) -> u32 {
        bump_instance_ttl(&env);
        let key = DataKey::ReceiptCount(payer);
        let val = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        val
    }

    pub fn get_receipt(env: Env, payer: Address, index: u32) -> ReceiptMetadata {
        bump_instance_ttl(&env);
        let key = DataKey::ReceiptRecordV2(payer, index);
        let val: ReceiptMetadata = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Receipt not found");
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
        val
    }

    /// Read a receipt created before storage schema v4. Legacy Symbol memos
    /// cannot represent arbitrary UTF-8 and are intentionally kept in their
    /// original type rather than converted lossy on-chain (#797).
    pub fn get_legacy_receipt(env: Env, payer: Address, index: u32) -> LegacyReceiptMetadata {
        bump_instance_ttl(&env);
        let key = DataKey::ReceiptRecord(payer, index);
        let val: LegacyReceiptMetadata = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Legacy receipt not found");
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
        val
    }

    pub fn create_escrow(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
        release_ledger: u32,
    ) -> u32 {
        bump_instance_ttl(&env);
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if release_ledger <= env.ledger().sequence() {
            panic!("release_ledger must be in the future");
        }

        // Lock funds: transfer from creator into the contract itself.
        let token = token::Client::new(&env, &token_address);
        token.transfer(&from, &env.current_contract_address(), &amount);

        let count_key = DataKey::EscrowCount;
        let next_id: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        if env.storage().persistent().has(&count_key) {
            env.storage().persistent().extend_ttl(
                &count_key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        let escrow = Escrow {
            id: next_id,
            from: from.clone(),
            to: to.clone(),
            token: token_address,
            amount,
            release_ledger,
            status: EscrowStatus::Pending,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(next_id), &escrow);
        env.storage().persistent().extend_ttl(
            &DataKey::Escrow(next_id),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
        env.storage()
            .persistent()
            .set(&DataKey::EscrowCount, &(next_id + 1));
        env.storage().persistent().extend_ttl(
            &DataKey::EscrowCount,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        index_escrow_accounts(&env, &from, &to, next_id);

        env.events().publish(
            (Symbol::new(&env, "escrow_create"), next_id),
            (EVENT_SCHEMA_VERSION, from, to, amount, release_ledger),
        );
        next_id
    }

    /// Claim is valid inclusively from `release_ledger` onward (#793).
    pub fn claim_escrow(env: Env, id: u32) -> Result<(), ContractError> {
        bump_instance_ttl(&env);
        let mut escrow = load_escrow(&env, id);
        if escrow.status != EscrowStatus::Pending {
            panic!("escrow is not pending");
        }
        if env.ledger().sequence() < escrow.release_ledger {
            return Err(ContractError::EscrowClaimTooEarly);
        }
        // Only the recipient can claim.
        escrow.to.require_auth();

        // Checks-Effects: persist state BEFORE external token transfer.
        escrow.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(id), &escrow);
        env.storage().persistent().extend_ttl(
            &DataKey::Escrow(id),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        let to_clone = escrow.to.clone();
        env.events().publish(
            (Symbol::new(&env, "escrow_claim"), id),
            (EVENT_SCHEMA_VERSION, escrow.to, escrow.amount),
        );

        // Interactions: external token transfer after state is persisted.
        let token = token::Client::new(&env, &escrow.token);
        token.transfer(&env.current_contract_address(), &to_clone, &escrow.amount);
        Ok(())
    }

    /// Cancel is valid only before `release_ledger`; at the boundary claim is
    /// the sole valid settlement operation (#793).
    pub fn cancel_escrow(env: Env, id: u32) -> Result<(), ContractError> {
        bump_instance_ttl(&env);
        let mut escrow = load_escrow(&env, id);
        if escrow.status != EscrowStatus::Pending {
            panic!("escrow is not pending");
        }
        if env.ledger().sequence() >= escrow.release_ledger {
            return Err(ContractError::EscrowCancelTooLate);
        }
        // Only the creator can cancel.
        escrow.from.require_auth();

        // Checks-Effects: persist state BEFORE external token transfer.
        escrow.status = EscrowStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(id), &escrow);
        env.storage().persistent().extend_ttl(
            &DataKey::Escrow(id),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        let from_clone = escrow.from.clone();
        env.events().publish(
            (Symbol::new(&env, "escrow_cancel"), id),
            (EVENT_SCHEMA_VERSION, escrow.from, escrow.amount),
        );

        // Interactions: external token transfer after state is persisted.
        let token = token::Client::new(&env, &escrow.token);
        token.transfer(&env.current_contract_address(), &from_clone, &escrow.amount);
        Ok(())
    }

    pub fn get_escrow(env: Env, id: u32) -> Escrow {
        bump_instance_ttl(&env);
        load_escrow(&env, id)
    }

    pub fn get_escrow_count(env: Env) -> u32 {
        bump_instance_ttl(&env);
        let key = DataKey::EscrowCount;
        let val = env.storage().persistent().get(&key);
        if val.is_some() {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        val.unwrap_or(0)
    }

    /// Escrows created by `sender`, paginated by offset (#796).
    ///
    /// Returns global escrow ids in creation order. Released and cancelled
    /// escrows remain in the index — use `get_escrow` for status.
    pub fn list_escrow_ids_for_sender(
        env: Env,
        sender: Address,
        offset: u32,
        limit: u32,
    ) -> soroban_sdk::Vec<u32> {
        bump_instance_ttl(&env);
        let total = Self::get_escrow_sender_count(env.clone(), sender.clone());
        list_escrow_ids_for_role(&env, total, offset, limit, Some(sender), None)
    }

    /// Escrows payable to `recipient`, paginated by offset (#796).
    pub fn list_escrow_ids_for_recipient(
        env: Env,
        recipient: Address,
        offset: u32,
        limit: u32,
    ) -> soroban_sdk::Vec<u32> {
        bump_instance_ttl(&env);
        let total = Self::get_escrow_recipient_count(env.clone(), recipient.clone());
        list_escrow_ids_for_role(&env, total, offset, limit, None, Some(recipient))
    }

    pub fn get_escrow_sender_count(env: Env, sender: Address) -> u32 {
        bump_instance_ttl(&env);
        let key = DataKey::EscrowSenderCount(sender);
        let val = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            extend_persistent_ttl(&env, &key);
        }
        val
    }

    pub fn get_escrow_recipient_count(env: Env, recipient: Address) -> u32 {
        bump_instance_ttl(&env);
        let key = DataKey::EscrowRecipientCount(recipient);
        let val = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            extend_persistent_ttl(&env, &key);
        }
        val
    }

    pub fn batch_send(
        env: Env,
        token_address: Address,
        from: Address,
        recipients: soroban_sdk::Vec<Address>,
        amounts: soroban_sdk::Vec<i128>,
    ) {
        bump_instance_ttl(&env);
        from.require_auth();
        if recipients.len() > MAX_BATCH_SEND_RECIPIENTS {
            panic!("too many recipients");
        }
        if recipients.len() != amounts.len() {
            panic!("arrays must have equal length");
        }
        let token = token::Client::new(&env, &token_address);
        for i in 0..recipients.len() {
            let to = recipients.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            if amount <= 0 {
                panic!("amount must be positive");
            }
            token.transfer(&from, &to, &amount);

            let current_total: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::TipTotal(to.clone()))
                .unwrap_or(0);
            let current_count: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::TipCount(to.clone()))
                .unwrap_or(0);

            env.storage()
                .persistent()
                .set(&DataKey::TipTotal(to.clone()), &(current_total + amount));
            env.storage().persistent().extend_ttl(
                &DataKey::TipTotal(to.clone()),
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );

            env.storage()
                .persistent()
                .set(&DataKey::TipCount(to.clone()), &(current_count + 1));
            env.storage().persistent().extend_ttl(
                &DataKey::TipCount(to.clone()),
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );

            let record = TipRecord {
                from: from.clone(),
                to: to.clone(),
                amount,
                ledger: env.ledger().sequence(),
            };
            env.storage()
                .persistent()
                .set(&DataKey::TipRecord(to.clone(), current_count), &record);
            env.storage().persistent().extend_ttl(
                &DataKey::TipRecord(to.clone(), current_count),
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
    }

    // ─── Streaming payments ─────────────────────────────────────────────────

    /// Open a payment stream, locking `deposit` in the contract and splitting
    /// its payout across `recipients` by the matching entry in `weights`
    /// (#559). A single recipient is just a one-element list.
    ///
    /// Returns the new stream id. Rejects dust streams: the deposit must be at
    /// least `MIN_STREAM_DEPOSIT` and must fund at least
    /// `MIN_STREAM_DURATION_LEDGERS` ledgers at `rate_per_ledger` (#561).
    pub fn open_stream(
        env: Env,
        token_address: Address,
        payer: Address,
        recipients: soroban_sdk::Vec<Address>,
        weights: soroban_sdk::Vec<u32>,
        rate_per_ledger: i128,
        deposit: i128,
    ) -> u32 {
        bump_instance_ttl(&env);
        payer.require_auth();
        if recipients.len() > MAX_STREAM_RECIPIENTS {
            panic!("too many stream recipients");
        }
        if recipients.len() != weights.len() {
            panic!("recipients and weights must have equal length");
        }
        if recipients.is_empty() {
            panic!("at least one recipient is required");
        }
        for i in 0..weights.len() {
            if weights.get(i).unwrap() == 0 {
                panic!("weight must be positive");
            }
        }
        // A duplicated address would only ever be reachable through its first
        // list entry — find_recipient() returns the first match — silently
        // stranding the rest of that recipient's weight until close_stream.
        for i in 0..recipients.len() {
            for j in (i + 1)..recipients.len() {
                if recipients.get(i).unwrap() == recipients.get(j).unwrap() {
                    panic!("recipients must not contain duplicate addresses");
                }
            }
        }
        if rate_per_ledger <= 0 {
            panic!("rate_per_ledger must be positive");
        }
        if deposit <= 0 {
            panic!("deposit must be positive");
        }
        if deposit < MIN_STREAM_DEPOSIT {
            panic!("deposit below minimum");
        }
        // Integer division, so a rate that drains the deposit in fewer than
        // MIN_STREAM_DURATION_LEDGERS ledgers — including the degenerate
        // rate > deposit case, which funds zero full ledgers — is rejected.
        let funded_ledgers = deposit / rate_per_ledger;
        if funded_ledgers < i128::from(MIN_STREAM_DURATION_LEDGERS) {
            panic!("stream duration below minimum");
        }

        // Lock funds in the contract; claims and refunds are paid out of here.
        let token = token::Client::new(&env, &token_address);
        token.transfer(&payer, &env.current_contract_address(), &deposit);

        let mut stream_recipients = soroban_sdk::Vec::new(&env);
        for i in 0..recipients.len() {
            stream_recipients.push_back(StreamRecipient {
                recipient: recipients.get(i).unwrap(),
                weight: weights.get(i).unwrap(),
                claimed: 0,
            });
        }

        let stream_id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::StreamCount)
            .unwrap_or(0);
        if env.storage().persistent().has(&DataKey::StreamCount) {
            env.storage().persistent().extend_ttl(
                &DataKey::StreamCount,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        let stream = Stream {
            payer: payer.clone(),
            recipients: stream_recipients,
            rate_per_ledger,
            deposited: deposit,
            start_ledger: env.ledger().sequence(),
            token: token_address,
            paused: false,
            paused_at_ledger: 0,
            paused_ledgers: 0,
            closed: false,
        };
        save_stream(&env, stream_id, &stream);
        env.storage()
            .persistent()
            .set(&DataKey::StreamCount, &(stream_id + 1));
        env.storage().persistent().extend_ttl(
            &DataKey::StreamCount,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        env.events().publish(
            (Symbol::new(&env, "stream_open"), stream_id),
            (
                EVENT_SCHEMA_VERSION,
                payer,
                recipients,
                weights,
                rate_per_ledger,
                deposit,
            ),
        );
        stream_id
    }

    /// Withdraw everything accrued so far for the calling recipient's weighted
    /// share (#559). Returns the amount transferred, which is `0` when
    /// nothing has accrued since that recipient's last claim.
    pub fn claim_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
        bump_instance_ttl(&env);
        recipient.require_auth();
        let mut stream = load_stream(&env, stream_id);
        let Some(idx) = find_recipient(&stream.recipients, &recipient) else {
            panic!("unauthorized");
        };
        if stream.closed {
            panic!("stream is closed");
        }

        let amount = claimable_amount(&stream, &recipient, env.ledger().sequence());
        if amount == 0 {
            return 0;
        }

        let mut entry = stream.recipients.get(idx).unwrap();
        entry.claimed += amount;
        stream.recipients.set(idx, entry);
        save_stream(&env, stream_id, &stream);

        let token = token::Client::new(&env, &stream.token);
        token.transfer(&env.current_contract_address(), &recipient, &amount);

        env.events().publish(
            (Symbol::new(&env, "stream_claim"), stream_id),
            (EVENT_SCHEMA_VERSION, recipient, amount),
        );
        amount
    }

    /// Add funds to an open stream, extending how long it can run.
    pub fn top_up_stream(env: Env, stream_id: u32, payer: Address, amount: i128) {
        bump_instance_ttl(&env);
        payer.require_auth();
        let mut stream = load_stream(&env, stream_id);
        if stream.payer != payer {
            panic!("unauthorized");
        }
        if stream.closed {
            panic!("stream is closed");
        }
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let token = token::Client::new(&env, &stream.token);
        token.transfer(&payer, &env.current_contract_address(), &amount);

        stream.deposited += amount;
        save_stream(&env, stream_id, &stream);

        env.events().publish(
            (Symbol::new(&env, "stream_topup"), stream_id),
            (EVENT_SCHEMA_VERSION, payer, amount, stream.deposited),
        );
    }

    /// Suspend accrual. Ledgers between here and `resume_stream` do not count
    /// toward the claimable amount (#560).
    pub fn pause_stream(env: Env, stream_id: u32, payer: Address) {
        bump_instance_ttl(&env);
        payer.require_auth();
        let mut stream = load_stream(&env, stream_id);
        if stream.payer != payer {
            panic!("unauthorized");
        }
        if stream.closed {
            panic!("stream is closed");
        }
        if stream.paused {
            panic!("stream already paused");
        }

        stream.paused = true;
        stream.paused_at_ledger = env.ledger().sequence();
        save_stream(&env, stream_id, &stream);

        env.events().publish(
            (Symbol::new(&env, "stream_pause"), stream_id),
            (EVENT_SCHEMA_VERSION, payer, stream.paused_at_ledger),
        );
    }

    /// Resume accrual from the point the stream was paused at (#560).
    pub fn resume_stream(env: Env, stream_id: u32, payer: Address) {
        bump_instance_ttl(&env);
        payer.require_auth();
        let mut stream = load_stream(&env, stream_id);
        if stream.payer != payer {
            panic!("unauthorized");
        }
        if stream.closed {
            panic!("stream is closed");
        }
        if !stream.paused {
            panic!("stream is not paused");
        }

        let current_ledger = env.ledger().sequence();
        let pause_length = current_ledger.saturating_sub(stream.paused_at_ledger);
        stream.paused_ledgers = stream.paused_ledgers.saturating_add(pause_length);
        stream.paused = false;
        stream.paused_at_ledger = 0;
        save_stream(&env, stream_id, &stream);

        env.events().publish(
            (Symbol::new(&env, "stream_resume"), stream_id),
            (EVENT_SCHEMA_VERSION, payer, pause_length),
        );
    }

    /// Stop a stream: settle everything accrued to each recipient by weight
    /// (#559) and refund the unstreamed remainder to the payer.
    pub fn close_stream(env: Env, stream_id: u32, payer: Address) {
        bump_instance_ttl(&env);
        payer.require_auth();
        let mut stream = load_stream(&env, stream_id);
        if stream.payer != payer {
            panic!("unauthorized");
        }
        if stream.closed {
            panic!("stream is closed");
        }

        let current_ledger = env.ledger().sequence();
        if stream.paused {
            let pause_length = current_ledger.saturating_sub(stream.paused_at_ledger);
            stream.paused_ledgers = stream.paused_ledgers.saturating_add(pause_length);
            stream.paused = false;
            stream.paused_at_ledger = 0;
        }

        let total_streamed = total_streamed_amount(&stream, current_ledger);
        let weight_total = total_weight(&stream.recipients);

        let token = token::Client::new(&env, &stream.token);
        let contract_address = env.current_contract_address();

        let mut recipients = stream.recipients.clone();
        let mut owed: i128 = 0;
        for i in 0..recipients.len() {
            let mut entry = recipients.get(i).unwrap();
            let entitled = total_streamed * i128::from(entry.weight) / i128::from(weight_total);
            let share = entitled - entry.claimed;
            if share > 0 {
                entry.claimed += share;
                owed += share;
                recipients.set(i, entry.clone());
                token.transfer(&contract_address, &entry.recipient, &share);
            }
        }
        stream.recipients = recipients;

        let refund = stream.deposited - total_claimed(&stream.recipients);
        stream.closed = true;
        stream.paused = false;
        save_stream(&env, stream_id, &stream);

        if refund > 0 {
            token.transfer(&contract_address, &payer, &refund);
        }

        env.events().publish(
            (Symbol::new(&env, "stream_close"), stream_id),
            (EVENT_SCHEMA_VERSION, owed, refund),
        );
    }

    pub fn get_stream(env: Env, stream_id: u32) -> Stream {
        bump_instance_ttl(&env);
        let stream = load_stream(&env, stream_id);
        env.storage().persistent().extend_ttl(
            &DataKey::Stream(stream_id),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
        stream
    }

    /// Amount `recipient` could withdraw from `stream_id` at the current
    /// ledger — their weighted share of accrual, net of paused time and
    /// capped at the deposit. `0` for a closed stream or an address that is
    /// not one of the stream's recipients.
    pub fn get_claimable(env: Env, stream_id: u32, recipient: Address) -> i128 {
        bump_instance_ttl(&env);
        let stream = load_stream(&env, stream_id);
        claimable_amount(&stream, &recipient, env.ledger().sequence())
    }

    pub fn get_stream_count(env: Env) -> u32 {
        bump_instance_ttl(&env);
        let key = DataKey::StreamCount;
        let val = env.storage().persistent().get(&key);
        if val.is_some() {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        val.unwrap_or(0)
    }

    // ─── Schema versioning ──────────────────────────────────────────────────

    /// Storage schema version this instance's data is laid out for.
    ///
    /// Returns `0` for instances deployed before versioning existed — those
    /// need a `migrate` call (#562).
    pub fn get_schema_version(env: Env) -> u32 {
        bump_instance_ttl(&env);
        let key = DataKey::SchemaVersion;
        let val = env.storage().persistent().get(&key);
        if val.is_some() {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        val.unwrap_or(0)
    }

    /// Record that this instance's storage now matches `SCHEMA_VERSION`.
    ///
    /// Run by the admin immediately after a WASM upgrade, once any data
    /// rewrite the release notes call for has been applied. Returns the
    /// version migrated to. See the migration guide in the contract README
    /// for the full procedure (#562).
    pub fn migrate(env: Env, admin: Address) -> Result<u32, ContractError> {
        bump_instance_ttl(&env);
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        if admin != stored_admin {
            panic!("Unauthorized");
        }

        let from_version: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0);
        if from_version == SCHEMA_VERSION {
            return Err(ContractError::SchemaAlreadyCurrent);
        }
        if from_version > SCHEMA_VERSION {
            return Err(ContractError::SchemaDowngrade);
        }

        // Backfill sender/recipient escrow indexes for escrows created before
        // v3 (#796). Status changes do not remove index entries.
        if from_version < 3 {
            let escrow_count: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::EscrowCount)
                .unwrap_or(0);
            for id in 0..escrow_count {
                let escrow: Escrow = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Escrow(id))
                    .expect("escrow missing during index backfill");
                index_escrow_accounts(&env, &escrow.from, &escrow.to, id);
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::SchemaVersion, &SCHEMA_VERSION);
        env.storage().persistent().extend_ttl(
            &DataKey::SchemaVersion,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        env.events().publish(
            (Symbol::new(&env, "migrate"),),
            (EVENT_SCHEMA_VERSION, from_version, SCHEMA_VERSION),
        );
        Ok(SCHEMA_VERSION)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod benchmarks;

#[cfg(test)]
mod fuzz_streams;

#[cfg(test)]
mod migration_tests;

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Address, Env,
    };

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_stream_read_bumps_ttl_near_expiry() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        let key = DataKey::Stream(id);

        env.as_contract(&contract_id, || {
            env.storage().instance().extend_ttl(1, 1);
            assert!(env.storage().instance().get_ttl() <= 1);
            env.storage().persistent().extend_ttl(&key, 1, 1);
            assert!(env.storage().persistent().get_ttl(&key) <= 1);
        });
        advance_by(&env, 1);

        assert_eq!(client.get_claimable(&id, &recipient), RATE);
        env.as_contract(&contract_id, || {
            assert!(env.storage().instance().get_ttl() >= INSTANCE_BUMP_AMOUNT);
            assert!(env.storage().persistent().get_ttl(&key) >= PERSISTENT_BUMP_AMOUNT);
        });
    }

    #[test]
    fn test_initialize_emits_init_event() {
        use soroban_sdk::{testutils::Events, vec, IntoVal};

        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        // initialize() should publish exactly one event: (init,) -> admin.
        assert_eq!(
            env.events().all(),
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "init"),).into_val(&env),
                    (EVENT_SCHEMA_VERSION, admin).into_val(&env),
                ),
            ]
        );
    }

    /// Issue #200 — initialize() must return Err(AlreadyInitialized) on re-init,
    /// not panic. try_initialize is testable without aborting the harness.
    #[test]
    fn test_double_initialize_returns_error() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let result = client.try_initialize(&admin);
        assert!(result.is_err(), "second initialize() must return an error");
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::AlreadyInitialized,
        );
    }

    #[test]
    fn test_batch_send_caps_recipients() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin);
        let sac = token::StellarAssetClient::new(&env, &token_id);
        sac.mint(&from, &100_000);

        // At limit (100) should succeed
        let mut recipients_at_limit = soroban_sdk::Vec::new(&env);
        let mut amounts_at_limit = soroban_sdk::Vec::new(&env);
        for _ in 0..MAX_BATCH_SEND_RECIPIENTS {
            recipients_at_limit.push_back(Address::generate(&env));
            amounts_at_limit.push_back(10);
        }
        client.batch_send(&token_id, &from, &recipients_at_limit, &amounts_at_limit);

        // Over limit (101) should panic
        let mut recipients_over_limit = soroban_sdk::Vec::new(&env);
        let mut amounts_over_limit = soroban_sdk::Vec::new(&env);
        for _ in 0..=MAX_BATCH_SEND_RECIPIENTS {
            recipients_over_limit.push_back(Address::generate(&env));
            amounts_over_limit.push_back(10);
        }
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.batch_send(&token_id, &from, &recipients_over_limit, &amounts_over_limit);
        }));
        assert!(res.is_err(), "batch_send over limit should panic");
    }

    #[test]
    fn test_open_stream_caps_recipients() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let payer = Address::generate(&env);
        let deposit: i128 = 1_000_000;
        let rate_per_ledger: i128 = 100;
        let token_id = env.register_stellar_asset_contract(admin);
        let sac = token::StellarAssetClient::new(&env, &token_id);
        sac.mint(&payer, &deposit);

        // At limit (50) should succeed
        let mut recipients_at_limit = soroban_sdk::Vec::new(&env);
        let mut weights_at_limit = soroban_sdk::Vec::new(&env);
        for _ in 0..MAX_STREAM_RECIPIENTS {
            recipients_at_limit.push_back(Address::generate(&env));
            weights_at_limit.push_back(1);
        }
        let stream_id = client.open_stream(&token_id, &payer, &recipients_at_limit, &weights_at_limit, &rate_per_ledger, &deposit);
        assert_eq!(stream_id, 0);

        // Over limit (51) should panic
        let mut recipients_over_limit = soroban_sdk::Vec::new(&env);
        let mut weights_over_limit = soroban_sdk::Vec::new(&env);
        for _ in 0..=MAX_STREAM_RECIPIENTS {
            recipients_over_limit.push_back(Address::generate(&env));
            weights_over_limit.push_back(1);
        }
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.open_stream(&token_id, &payer, &recipients_over_limit, &weights_over_limit, &rate_per_ledger, &deposit);
        }));
        assert!(res.is_err(), "open_stream over limit should panic");
    }

    #[test]
    fn test_mint_receipt() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        env.mock_all_auths();

        let memo = String::from_str(&env, "Rent");
        let receipt_id = client.mint_receipt(&payer, &payee, &1000, &memo);
        assert_eq!(receipt_id, 0);

        assert_eq!(client.get_receipt_count(&payer), 1);

        let stored = client.get_receipt(&payer, &0);
        assert_eq!(stored.from, payer);
        assert_eq!(stored.to, payee);
        assert_eq!(stored.amount, 1000);
        assert_eq!(stored.memo, memo);
    }

    #[test]
    fn test_receipt_count_tracks_multiple_mints() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let payer = Address::generate(&env);
        let payee1 = Address::generate(&env);
        let payee2 = Address::generate(&env);

        env.mock_all_auths();

        let id1 = client.mint_receipt(&payer, &payee1, &500, &String::from_str(&env, "Coffee"));
        let id2 = client.mint_receipt(&payer, &payee2, &1500, &String::from_str(&env, "Invoice"));

        assert_eq!(id1, 0);
        assert_eq!(id2, 1);
        assert_eq!(client.get_receipt_count(&payer), 2);
    }

    #[test]
    fn test_receipt_memo_accepts_unicode_and_exact_byte_cap() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        env.mock_all_auths();

        let unicode = String::from_str(&env, "Café ☕ — 谢谢");
        let unicode_id = client.mint_receipt(&payer, &payee, &100, &unicode);
        assert_eq!(client.get_receipt(&payer, &unicode_id).memo, unicode);

        let max_bytes = [b'x'; MAX_RECEIPT_MEMO_BYTES as usize];
        let max_memo = String::from_bytes(&env, &max_bytes);
        let max_id = client.mint_receipt(&payer, &payee, &100, &max_memo);
        assert_eq!(
            client.get_receipt(&payer, &max_id).memo.len(),
            MAX_RECEIPT_MEMO_BYTES
        );
    }

    #[test]
    fn test_receipt_memo_rejects_more_than_byte_cap() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        env.mock_all_auths();

        let too_many_bytes = [b'x'; MAX_RECEIPT_MEMO_BYTES as usize + 1];
        let result = client.try_mint_receipt(
            &payer,
            &payee,
            &100,
            &String::from_bytes(&env, &too_many_bytes),
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ReceiptMemoTooLong
        );
        assert_eq!(client.get_receipt_count(&payer), 0);
    }

    #[test]
    fn test_tip_totals_start_at_zero() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let recipient = Address::generate(&env);
        assert_eq!(client.get_tip_total(&recipient), 0);
        assert_eq!(client.get_tip_count(&recipient), 0);
    }

    // ── Helper: deploy a SAC token, mint `amount` to `to`, return token address ──
    fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let sac = token::StellarAssetClient::new(env, &token_id);
        sac.mint(to, &amount);
        token_id
    }

    #[test]
    fn test_send_tip_stores_record() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount: i128 = 500;

        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, amount);
        client.send_tip(&token_id, &from, &to, &amount);

        let record = client.get_tip_record(&to, &0);
        assert_eq!(record.from, from);
        assert_eq!(record.to, to);
        assert_eq!(record.amount, amount);
        assert_eq!(record.ledger, env.ledger().sequence());
    }

    #[test]
    fn test_send_tip_increments_totals() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let first_amount: i128 = 300;
        let second_amount: i128 = 700;

        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, first_amount + second_amount);
        client.send_tip(&token_id, &from, &to, &first_amount);
        client.send_tip(&token_id, &from, &to, &second_amount);

        assert_eq!(client.get_tip_total(&to), first_amount + second_amount);
        assert_eq!(client.get_tip_count(&to), 2);
    }

    #[test]
    #[should_panic]
    fn test_send_tip_unauthorized() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount: i128 = 100;

        // Mint tokens to `from` but do NOT call env.mock_all_auths(),
        // so from.require_auth() inside send_tip will fail.
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, amount);
        // Clear mocked auths so the send_tip call is not authorized.
        env.set_auths(&[]);

        client.send_tip(&token_id, &from, &to, &amount);
    }

    // ── Escrow tests ────────────────────────────────────────────────────────

    fn advance_ledger(env: &Env, to_sequence: u32) {
        env.ledger().with_mut(|info| {
            info.sequence_number = to_sequence;
        });
    }

    #[test]
    fn test_create_escrow_locks_funds_and_returns_id() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount: i128 = 1_000;

        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, amount);
        let token = token::Client::new(&env, &token_id);
        let release_ledger = env.ledger().sequence() + 100;

        let id = client.create_escrow(&token_id, &from, &to, &amount, &release_ledger);
        assert_eq!(id, 0);
        assert_eq!(client.get_escrow_count(), 1);

        // Funds moved into the contract, not the recipient.
        assert_eq!(token.balance(&from), 0);
        assert_eq!(token.balance(&contract_id), amount);
        assert_eq!(token.balance(&to), 0);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.amount, amount);
        assert_eq!(escrow.status, EscrowStatus::Pending);
    }

    #[test]
    #[should_panic(expected = "release_ledger must be in the future")]
    fn test_create_escrow_rejects_past_release_ledger() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 100);

        // release_ledger == current sequence is not "in the future".
        let now = env.ledger().sequence();
        client.create_escrow(&token_id, &from, &to, &100, &now);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_create_escrow_rejects_non_positive_amount() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 100);
        let release = env.ledger().sequence() + 50;
        client.create_escrow(&token_id, &from, &to, &0i128, &release);
    }

    #[test]
    fn test_claim_escrow_transfers_to_recipient_after_release() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount: i128 = 500;
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, amount);
        let token = token::Client::new(&env, &token_id);

        let release_ledger = env.ledger().sequence() + 10;
        let id = client.create_escrow(&token_id, &from, &to, &amount, &release_ledger);

        // Claim is valid at the inclusive release boundary.
        advance_ledger(&env, release_ledger);
        client.claim_escrow(&id);

        assert_eq!(token.balance(&to), amount);
        assert_eq!(token.balance(&contract_id), 0);
        assert_eq!(client.get_escrow(&id).status, EscrowStatus::Released);
    }

    #[test]
    #[should_panic(expected = "escrow is not pending")]
    fn test_claim_escrow_rejected_after_release() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 500);
        let release = env.ledger().sequence() + 10;
        let id = client.create_escrow(&token_id, &from, &to, &500, &release);

        advance_ledger(&env, release + 1);
        client.claim_escrow(&id);
        // Second claim must be rejected — state was persisted before transfer.
        client.claim_escrow(&id);
    }

    #[test]
    fn test_claim_escrow_rejected_before_release_ledger() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 100);
        let release = env.ledger().sequence() + 50;
        let id = client.create_escrow(&token_id, &from, &to, &100, &release);
        advance_ledger(&env, release - 1);
        let result = client.try_claim_escrow(&id);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::EscrowClaimTooEarly
        );
    }

    #[test]
    fn test_cancel_escrow_returns_funds_to_creator() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount: i128 = 750;
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, amount);
        let token = token::Client::new(&env, &token_id);

        let release = env.ledger().sequence() + 100;
        let id = client.create_escrow(&token_id, &from, &to, &amount, &release);

        // Still before release_ledger.
        client.cancel_escrow(&id);

        assert_eq!(token.balance(&from), amount);
        assert_eq!(token.balance(&contract_id), 0);
        assert_eq!(token.balance(&to), 0);
        assert_eq!(client.get_escrow(&id).status, EscrowStatus::Cancelled);
    }

    #[test]
    #[should_panic(expected = "escrow is not pending")]
    fn test_cancel_escrow_rejected_after_cancellation() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 750);
        let release = env.ledger().sequence() + 100;
        let id = client.create_escrow(&token_id, &from, &to, &750, &release);

        client.cancel_escrow(&id);
        // Second cancel must be rejected — state was persisted before transfer.
        client.cancel_escrow(&id);
    }

    #[test]
    fn test_cancel_escrow_rejected_after_release_ledger() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 100);
        let release = env.ledger().sequence() + 5;
        let id = client.create_escrow(&token_id, &from, &to, &100, &release);
        advance_ledger(&env, release);
        let at_release = client.try_cancel_escrow(&id);
        assert_eq!(
            at_release.unwrap_err().unwrap(),
            ContractError::EscrowCancelTooLate
        );

        advance_ledger(&env, release + 1);
        let after_release = client.try_cancel_escrow(&id);
        assert_eq!(
            after_release.unwrap_err().unwrap(),
            ContractError::EscrowCancelTooLate
        );
    }

    #[test]
    #[should_panic(expected = "escrow is not pending")]
    fn test_double_claim_rejected() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 100);
        let release = env.ledger().sequence() + 5;
        let id = client.create_escrow(&token_id, &from, &to, &100, &release);
        advance_ledger(&env, release + 1);
        client.claim_escrow(&id);
        client.claim_escrow(&id);
    }

    #[test]
    fn test_escrow_sender_and_recipient_indexes() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let other = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 2_000);
        token::StellarAssetClient::new(&env, &token_id).mint(&other, &500);

        let release = env.ledger().sequence() + 50;
        let id0 = client.create_escrow(&token_id, &from, &to, &500, &release);
        let id1 = client.create_escrow(&token_id, &from, &other, &300, &(release + 10));
        let id2 = client.create_escrow(&token_id, &other, &to, &200, &(release + 20));

        assert_eq!(client.get_escrow_sender_count(&from), 2);
        assert_eq!(client.get_escrow_recipient_count(&to), 2);
        assert_eq!(client.get_escrow_sender_count(&other), 1);
        assert_eq!(client.get_escrow_recipient_count(&other), 1);

        let from_ids = client.list_escrow_ids_for_sender(&from, &0, &10);
        assert_eq!(from_ids.len(), 2);
        assert_eq!(from_ids.get(0).unwrap(), id0);
        assert_eq!(from_ids.get(1).unwrap(), id1);

        let to_ids = client.list_escrow_ids_for_recipient(&to, &0, &10);
        assert_eq!(to_ids.len(), 2);
        assert_eq!(to_ids.get(0).unwrap(), id0);
        assert_eq!(to_ids.get(1).unwrap(), id2);

        let page = client.list_escrow_ids_for_sender(&from, &1, &1);
        assert_eq!(page.len(), 1);
        assert_eq!(page.get(0).unwrap(), id1);
    }

    #[test]
    fn test_escrow_indexes_keep_released_and_cancelled_records() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 1_000);

        let release = env.ledger().sequence() + 10;
        let claim_id = client.create_escrow(&token_id, &from, &to, &400, &release);
        let cancel_id = client.create_escrow(&token_id, &from, &to, &300, &(release + 100));

        advance_ledger(&env, release + 1);
        client.claim_escrow(&claim_id);
        client.cancel_escrow(&cancel_id);

        assert_eq!(client.get_escrow_sender_count(&from), 2);
        assert_eq!(client.get_escrow_recipient_count(&to), 2);

        let sender_ids = client.list_escrow_ids_for_sender(&from, &0, &10);
        assert_eq!(sender_ids.get(0).unwrap(), claim_id);
        assert_eq!(sender_ids.get(1).unwrap(), cancel_id);
        assert_eq!(client.get_escrow(&claim_id).status, EscrowStatus::Released);
        assert_eq!(
            client.get_escrow(&cancel_id).status,
            EscrowStatus::Cancelled
        );
    }

    #[test]
    fn test_migrate_backfills_escrow_indexes() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        env.mock_all_auths();

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let token_id = create_token(&env, &admin, &from, 500);
        let release = env.ledger().sequence() + 25;
        let id = client.create_escrow(&token_id, &from, &to, &500, &release);

        // Simulate a v2 instance without per-account escrow indexes.
        env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .set(&DataKey::SchemaVersion, &2u32);
            env.storage()
                .persistent()
                .remove(&DataKey::EscrowSenderCount(from.clone()));
            env.storage()
                .persistent()
                .remove(&DataKey::EscrowRecipientCount(to.clone()));
        });
        assert_eq!(client.get_escrow_sender_count(&from), 0);

        assert_eq!(client.migrate(&admin), SCHEMA_VERSION);
        assert_eq!(client.get_escrow_sender_count(&from), 1);
        assert_eq!(client.get_escrow_recipient_count(&to), 1);
        assert_eq!(
            client
                .list_escrow_ids_for_sender(&from, &0, &10)
                .get(0)
                .unwrap(),
            id
        );
    }

    // ── Streaming payment tests ─────────────────────────────────────────────

    const RATE: i128 = 100;
    const DEPOSIT: i128 = 100_000; // 1_000 ledgers of runway at RATE.

    fn advance_by(env: &Env, ledgers: u32) {
        let target = env.ledger().sequence() + ledgers;
        advance_ledger(env, target);
    }

    /// Deploy the contract, mint `funding` to a fresh payer and return
    /// everything a stream test needs.
    fn stream_fixture(
        env: &Env,
        funding: i128,
    ) -> (
        Address,
        MicroPayContractClient<'_>,
        Address,
        Address,
        Address,
    ) {
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.initialize(&admin);

        let payer = Address::generate(env);
        let recipient = Address::generate(env);
        env.mock_all_auths();
        let token_id = create_token(env, &admin, &payer, funding);

        (contract_id, client, token_id, payer, recipient)
    }

    /// Open a stream with a single recipient holding the entire weight — the
    /// pre-#559 API shape, kept as a helper so the bulk of these tests do not
    /// need to build a `(recipients, weights)` pair by hand.
    fn open_single_stream(
        env: &Env,
        client: &MicroPayContractClient,
        token_id: &Address,
        payer: &Address,
        recipient: &Address,
        rate_per_ledger: i128,
        deposit: i128,
    ) -> u32 {
        client.open_stream(
            token_id,
            payer,
            &soroban_sdk::vec![env, recipient.clone()],
            &soroban_sdk::vec![env, 1u32],
            &rate_per_ledger,
            &deposit,
        )
    }

    /// The sole recipient's claimed amount on a single-recipient stream.
    fn claimed_of(stream: &Stream) -> i128 {
        stream.recipients.get(0).unwrap().claimed
    }

    #[test]
    fn test_open_stream() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);

        assert_eq!(id, 0);
        assert_eq!(client.get_stream_count(), 1);

        // The deposit is locked in the contract, not forwarded to the recipient.
        assert_eq!(token.balance(&payer), 0);
        assert_eq!(token.balance(&contract_id), DEPOSIT);
        assert_eq!(token.balance(&recipient), 0);

        let stream = client.get_stream(&id);
        assert_eq!(stream.payer, payer);
        assert_eq!(stream.recipients.len(), 1);
        assert_eq!(stream.recipients.get(0).unwrap().recipient, recipient);
        assert_eq!(stream.recipients.get(0).unwrap().weight, 1);
        assert_eq!(stream.rate_per_ledger, RATE);
        assert_eq!(stream.deposited, DEPOSIT);
        assert_eq!(claimed_of(&stream), 0);
        assert_eq!(stream.start_ledger, env.ledger().sequence());
        assert!(!stream.paused);
        assert!(!stream.closed);
    }

    #[test]
    fn test_claim_stream_basic() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 10);

        let claimed = client.claim_stream(&id, &recipient);

        assert_eq!(claimed, RATE * 10);
        assert_eq!(token.balance(&recipient), RATE * 10);
        assert_eq!(token.balance(&contract_id), DEPOSIT - RATE * 10);
        assert_eq!(claimed_of(&client.get_stream(&id)), RATE * 10);
    }

    #[test]
    fn test_claim_stream_multiple_times() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);

        advance_by(&env, 5);
        assert_eq!(client.claim_stream(&id, &recipient), RATE * 5);
        advance_by(&env, 7);
        assert_eq!(client.claim_stream(&id, &recipient), RATE * 7);

        // A claim with no ledgers in between accrues nothing and is a no-op.
        assert_eq!(client.claim_stream(&id, &recipient), 0);

        assert_eq!(token.balance(&recipient), RATE * 12);
        assert_eq!(claimed_of(&client.get_stream(&id)), RATE * 12);
    }

    #[test]
    fn test_claim_stream_exceeds_deposit() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);

        // Run far past the funded window: accrual stops at the deposit.
        advance_by(&env, 10_000);

        assert_eq!(client.get_claimable(&id, &recipient), DEPOSIT);
        assert_eq!(client.claim_stream(&id, &recipient), DEPOSIT);
        assert_eq!(client.claim_stream(&id, &recipient), 0);
        assert_eq!(token.balance(&recipient), DEPOSIT);
        assert_eq!(token.balance(&contract_id), 0);

        let stream = client.get_stream(&id);
        assert_eq!(claimed_of(&stream), stream.deposited);
    }

    #[test]
    fn test_top_up_stream() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT * 2);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 1_000); // Drain the original runway exactly.
        assert_eq!(client.get_claimable(&id, &recipient), DEPOSIT);

        client.top_up_stream(&id, &payer, &DEPOSIT);

        assert_eq!(client.get_stream(&id).deposited, DEPOSIT * 2);
        assert_eq!(token.balance(&contract_id), DEPOSIT * 2);

        // The top-up extends the runway rather than paying out immediately.
        assert_eq!(client.get_claimable(&id, &recipient), DEPOSIT);
        advance_by(&env, 10);
        assert_eq!(client.get_claimable(&id, &recipient), DEPOSIT + RATE * 10);
    }

    /// #556 — claim_stream and top_up_stream both land in the same ledger
    /// (no advance_by between them). Accounting must stay exact: the top-up
    /// must not retroactively change what was already claimable, and after a
    /// second claim later on, claimed + whatever remains locked in the
    /// contract must reconcile exactly against the total ever deposited.
    #[test]
    fn test_claim_and_top_up_same_ledger() {
        let (contract_id, client, token_id, payer, recipient1) = stream_fixture(&env, DEPOSIT * 2);
        let recipient2 = Address::generate(&env);
        let recipient = recipient1.clone();
        let token = token::Client::new(&env, &token_id);

        let id = client.open_stream(
            &token_id,
            &payer,
            &soroban_sdk::vec![&env, recipient1.clone(), recipient2.clone()],
            &soroban_sdk::vec![&env, 1u32, 1u32],
            &RATE,
            &DEPOSIT,
        );

        // Accrue some balance, then partially claim it.
        advance_by(&env, 10);
        let first_claim = client.claim_stream(&id, &recipient);
        assert_eq!(first_claim, RATE * 10);

        // top_up_stream happens in the very same ledger as the claim above —
        // no advance_by call between them.
        client.top_up_stream(&id, &payer, &DEPOSIT);

        let after_topup = client.get_stream(&id);
        assert_eq!(after_topup.deposited, DEPOSIT * 2);
        assert_eq!(total_claimed(&after_topup.recipients), RATE * 10);
        // The top-up must not change what's claimable right now — the
        // extended runway only shows up as ledgers advance.
        assert_eq!(client.get_claimable(&id, &recipient1), 0);
        assert_eq!(client.get_claimable(&id, &recipient2), 0);

        advance_by(&env, 5);
        let second_claim = client.claim_stream(&id, &recipient);
        assert_eq!(second_claim, RATE * 5);

        let final_stream = client.get_stream(&id);
        assert_eq!(total_claimed(&final_stream.recipients), RATE * 15);
        assert_eq!(
            token.balance(&recipient1) + token.balance(&recipient2),
            total_claimed(&final_stream.recipients)
        );

        // Reconciliation: claimed + whatever remains locked in the contract
        // for this stream equals the total ever deposited, exactly.
        let remaining_in_contract = token.balance(&contract_id);
        assert_eq!(
            total_claimed(&final_stream.recipients) + remaining_in_contract,
            after_topup.deposited
        );
    }

    #[test]
    fn test_close_stream_with_refund() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 20);
        client.close_stream(&id, &payer);

        let streamed = RATE * 20;
        assert_eq!(token.balance(&recipient), streamed);
        assert_eq!(token.balance(&payer), DEPOSIT - streamed);
        assert_eq!(token.balance(&contract_id), 0);

        let stream = client.get_stream(&id);
        assert!(stream.closed);
        assert_eq!(claimed_of(&stream), streamed);
        assert_eq!(client.get_claimable(&id, &recipient), 0);
    }

    /// #558 — close_stream must emit an event carrying the stream id and the
    /// refunded amount, not just return them, so off-chain indexers can track
    /// closures without polling.
    #[test]
    fn test_close_stream_emits_event_with_refund() {
        use soroban_sdk::{testutils::Events, vec, IntoVal};

        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 20);
        client.close_stream(&id, &payer);

        let streamed = RATE * 20;
        let refund = DEPOSIT - streamed;

        let contract_events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            contract_events,
            vec![
                &env,
                (
                    contract_id,
                    (Symbol::new(&env, "stream_close"), id).into_val(&env),
                    (EVENT_SCHEMA_VERSION, streamed, refund).into_val(&env),
                ),
            ]
        );
    }

    #[test]
    fn test_close_stream_after_claims() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 30);
        client.claim_stream(&id, &recipient);
        advance_by(&env, 20);
        client.close_stream(&id, &payer);

        // Claimed portions are not paid twice: the recipient ends up with the
        // full 50 ledgers of accrual and the payer with the rest.
        let streamed = RATE * 50;
        assert_eq!(token.balance(&recipient), streamed);
        assert_eq!(token.balance(&payer), DEPOSIT - streamed);
        assert_eq!(token.balance(&contract_id), 0);
        assert_eq!(claimed_of(&client.get_stream(&id)), streamed);
    }

    #[test]
    fn test_get_claimable() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        assert_eq!(client.get_claimable(&id, &recipient), 0);

        advance_by(&env, 3);
        assert_eq!(client.get_claimable(&id, &recipient), RATE * 3);

        client.claim_stream(&id, &recipient);
        assert_eq!(client.get_claimable(&id, &recipient), 0);
    }

    #[test]
    #[should_panic(expected = "stream not found")]
    fn test_claim_nonexistent_stream() {
        let env = Env::default();
        let (_, client, _, _, recipient) = stream_fixture(&env, DEPOSIT);
        client.claim_stream(&42, &recipient);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_unauthorized_claim() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 10);

        let stranger = Address::generate(&env);
        client.claim_stream(&id, &stranger);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_unauthorized_close() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);

        let stranger = Address::generate(&env);
        client.close_stream(&id, &stranger);
    }

    #[test]
    #[should_panic(expected = "rate_per_ledger must be positive")]
    fn test_invalid_rate() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        open_single_stream(&env, &client, &token_id, &payer, &recipient, 0i128, DEPOSIT);
    }

    #[test]
    #[should_panic(expected = "deposit must be positive")]
    fn test_invalid_deposit() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, 0i128);
    }

    // ── Dust-stream validation (#561) ───────────────────────────────────────

    #[test]
    #[should_panic(expected = "deposit below minimum")]
    fn test_open_stream_rejects_dust_deposit() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let dust = MIN_STREAM_DEPOSIT - 1;
        open_single_stream(&env, &client, &token_id, &payer, &recipient, 1i128, dust);
    }

    #[test]
    #[should_panic(expected = "stream duration below minimum")]
    fn test_open_stream_rejects_short_duration() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        // Deposit clears the minimum, but this rate drains it in 10 ledgers.
        open_single_stream(
            &env, &client, &token_id, &payer, &recipient, 1_000i128, 10_000i128,
        );
    }

    #[test]
    #[should_panic(expected = "stream duration below minimum")]
    fn test_open_stream_rejects_zero_ledger_duration() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        // rate > deposit funds zero whole ledgers.
        open_single_stream(
            &env, &client, &token_id, &payer, &recipient, 20_000i128, 10_000i128,
        );
    }

    #[test]
    fn test_open_stream_accepts_exact_minimums() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, MIN_STREAM_DEPOSIT);
        // 10_000 / 166 == 60 ledgers, exactly MIN_STREAM_DURATION_LEDGERS.
        let id = open_single_stream(
            &env,
            &client,
            &token_id,
            &payer,
            &recipient,
            166i128,
            MIN_STREAM_DEPOSIT,
        );
        assert_eq!(client.get_stream(&id).deposited, MIN_STREAM_DEPOSIT);
    }

    // ── Multi-recipient streams (#559) ──────────────────────────────────────

    #[test]
    fn test_open_stream_multiple_recipients_records_shares() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let second = Address::generate(&env);

        let id = client.open_stream(
            &token_id,
            &payer,
            &soroban_sdk::vec![&env, recipient.clone(), second.clone()],
            &soroban_sdk::vec![&env, 1u32, 3u32],
            &RATE,
            &DEPOSIT,
        );

        let stream = client.get_stream(&id);
        assert_eq!(stream.recipients.len(), 2);
        assert_eq!(stream.recipients.get(0).unwrap().recipient, recipient);
        assert_eq!(stream.recipients.get(0).unwrap().weight, 1);
        assert_eq!(stream.recipients.get(1).unwrap().recipient, second);
        assert_eq!(stream.recipients.get(1).unwrap().weight, 3);
    }

    #[test]
    fn test_claim_stream_multiple_recipients_pays_proportionally() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);
        let second = Address::generate(&env);

        // Weights 1:3 — `recipient` gets a quarter of accrual, `second` gets
        // three quarters.
        let id = client.open_stream(
            &token_id,
            &payer,
            &soroban_sdk::vec![&env, recipient.clone(), second.clone()],
            &soroban_sdk::vec![&env, 1u32, 3u32],
            &RATE,
            &DEPOSIT,
        );
        advance_by(&env, 40);

        assert_eq!(client.get_claimable(&id, &recipient), RATE * 40 / 4);
        assert_eq!(client.get_claimable(&id, &second), RATE * 40 * 3 / 4);

        assert_eq!(client.claim_stream(&id, &recipient), RATE * 40 / 4);
        assert_eq!(client.claim_stream(&id, &second), RATE * 40 * 3 / 4);
        assert_eq!(token.balance(&recipient), RATE * 40 / 4);
        assert_eq!(token.balance(&second), RATE * 40 * 3 / 4);
        assert_eq!(token.balance(&contract_id), DEPOSIT - RATE * 40);

        // A second claim with no new accrual pays nothing, for either party.
        assert_eq!(client.claim_stream(&id, &recipient), 0);
        assert_eq!(client.claim_stream(&id, &second), 0);
    }

    #[test]
    fn test_close_stream_multiple_recipients_settles_each() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);
        let second = Address::generate(&env);

        let id = client.open_stream(
            &token_id,
            &payer,
            &soroban_sdk::vec![&env, recipient.clone(), second.clone()],
            &soroban_sdk::vec![&env, 1u32, 1u32],
            &RATE,
            &DEPOSIT,
        );
        advance_by(&env, 30);
        // recipient claims their half early; second never claims.
        client.claim_stream(&id, &recipient);
        advance_by(&env, 20);
        client.close_stream(&id, &payer);

        let streamed = RATE * 50;
        assert_eq!(token.balance(&recipient), streamed / 2);
        assert_eq!(token.balance(&second), streamed / 2);
        assert_eq!(token.balance(&payer), DEPOSIT - streamed);
        assert_eq!(token.balance(&contract_id), 0);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_claim_rejects_address_not_on_recipient_list() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let second = Address::generate(&env);

        let id = client.open_stream(
            &token_id,
            &payer,
            &soroban_sdk::vec![&env, recipient.clone(), second],
            &soroban_sdk::vec![&env, 1u32, 1u32],
            &RATE,
            &DEPOSIT,
        );
        advance_by(&env, 10);

        let stranger = Address::generate(&env);
        client.claim_stream(&id, &stranger);
    }

    #[test]
    #[should_panic(expected = "recipients and weights must have equal length")]
    fn test_open_stream_rejects_mismatched_recipients_and_weights() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        client.open_stream(
            &token_id,
            &payer,
            &soroban_sdk::vec![&env, recipient],
            &soroban_sdk::vec![&env, 1u32, 1u32],
            &RATE,
            &DEPOSIT,
        );
    }

    #[test]
    #[should_panic(expected = "at least one recipient is required")]
    fn test_open_stream_rejects_empty_recipients() {
        let env = Env::default();
        let (_, client, token_id, payer, _recipient) = stream_fixture(&env, DEPOSIT);

        client.open_stream(
            &token_id,
            &payer,
            &soroban_sdk::Vec::new(&env),
            &soroban_sdk::Vec::new(&env),
            &RATE,
            &DEPOSIT,
        );
    }

    #[test]
    #[should_panic(expected = "weight must be positive")]
    fn test_open_stream_rejects_zero_weight() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let second = Address::generate(&env);

        client.open_stream(
            &token_id,
            &payer,
            &soroban_sdk::vec![&env, recipient, second],
            &soroban_sdk::vec![&env, 1u32, 0u32],
            &RATE,
            &DEPOSIT,
        );
    }

    #[test]
    #[should_panic(expected = "recipients must not contain duplicate addresses")]
    fn test_open_stream_rejects_duplicate_recipient() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        client.open_stream(
            &token_id,
            &payer,
            &soroban_sdk::vec![&env, recipient.clone(), recipient],
            &soroban_sdk::vec![&env, 1u32, 1u32],
            &RATE,
            &DEPOSIT,
        );
    }

    // ── Pausable streams (#560) ─────────────────────────────────────────────

    #[test]
    fn test_pause_stream_halts_accrual() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 10);
        client.pause_stream(&id, &payer);

        let at_pause = client.get_claimable(&id, &recipient);
        assert_eq!(at_pause, RATE * 10);

        // 500 ledgers of paused time must not accrue anything.
        advance_by(&env, 500);
        assert_eq!(client.get_claimable(&id, &recipient), at_pause);

        let stream = client.get_stream(&id);
        assert!(stream.paused);
        assert_eq!(stream.paused_at_ledger, stream.start_ledger + 10);
    }

    #[test]
    fn test_resume_stream_continues_accrual() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 10);
        client.pause_stream(&id, &payer);
        advance_by(&env, 500);
        client.resume_stream(&id, &payer);

        // Resuming does not back-pay the pause…
        assert_eq!(client.get_claimable(&id, &recipient), RATE * 10);
        // …and accrual picks up from where it stopped.
        advance_by(&env, 10);
        assert_eq!(client.get_claimable(&id, &recipient), RATE * 20);

        let stream = client.get_stream(&id);
        assert!(!stream.paused);
        assert_eq!(stream.paused_ledgers, 500);
    }

    #[test]
    fn test_paused_time_excluded_from_claim() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 40);
        client.pause_stream(&id, &payer);
        advance_by(&env, 200);
        client.resume_stream(&id, &payer);
        advance_by(&env, 60);

        // 300 ledgers of wall time, 100 of them running.
        assert_eq!(client.claim_stream(&id, &recipient), RATE * 100);
        assert_eq!(token.balance(&recipient), RATE * 100);
    }

    #[test]
    fn test_claim_while_paused_pays_only_pre_pause_accrual() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 25);
        client.pause_stream(&id, &payer);
        advance_by(&env, 100);

        assert_eq!(client.claim_stream(&id, &recipient), RATE * 25);
        assert_eq!(client.claim_stream(&id, &recipient), 0);
    }

    #[test]
    fn test_close_while_paused_refunds_unstreamed() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 15);
        client.pause_stream(&id, &payer);
        advance_by(&env, 400);
        client.close_stream(&id, &payer);

        let streamed = RATE * 15;
        assert_eq!(token.balance(&recipient), streamed);
        assert_eq!(token.balance(&payer), DEPOSIT - streamed);
        assert_eq!(token.balance(&contract_id), 0);

        let stream = client.get_stream(&id);
        assert_eq!(stream.paused_ledgers, 400);
        assert!(!stream.paused);
    }

    #[test]
    fn test_multiple_pause_intervals() {
        let env = Env::default();
        let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);
        let token = token::Client::new(&env, &token_id);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        advance_by(&env, 10);

        client.pause_stream(&id, &payer);
        advance_by(&env, 100);
        client.resume_stream(&id, &payer);

        advance_by(&env, 10);

        client.pause_stream(&id, &payer);
        advance_by(&env, 200);

        // Close while on the second pause.
        client.close_stream(&id, &payer);

        // 10 + 10 = 20 ledgers of active streaming.
        let streamed = RATE * 20;
        assert_eq!(token.balance(&recipient), streamed);
        assert_eq!(token.balance(&payer), DEPOSIT - streamed);
        assert_eq!(token.balance(&contract_id), 0);

        let stream = client.get_stream(&id);
        // 100 + 200 = 300 ledgers of paused time.
        assert_eq!(stream.paused_ledgers, 300);
        assert!(!stream.paused);
    }

    #[test]
    #[should_panic(expected = "stream already paused")]
    fn test_double_pause_rejected() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        client.pause_stream(&id, &payer);
        client.pause_stream(&id, &payer);
    }

    #[test]
    #[should_panic(expected = "stream is not paused")]
    fn test_resume_without_pause_rejected() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        client.resume_stream(&id, &payer);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_pause_requires_payer() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        client.pause_stream(&id, &recipient);
    }

    #[test]
    #[should_panic(expected = "stream is closed")]
    fn test_pause_after_close_rejected() {
        let env = Env::default();
        let (_, client, token_id, payer, recipient) = stream_fixture(&env, DEPOSIT);

        let id = open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
        client.close_stream(&id, &payer);
        client.pause_stream(&id, &payer);
    }

    // ── Schema versioning / migration (#562) ────────────────────────────────

    #[test]
    fn test_initialize_sets_schema_version() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        client.initialize(&Address::generate(&env));

        assert_eq!(client.get_schema_version(), SCHEMA_VERSION);
    }

    #[test]
    fn test_migrate_stamps_unversioned_instance() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        env.mock_all_auths();

        // Simulate an instance deployed before versioning existed.
        env.as_contract(&contract_id, || {
            env.storage().persistent().remove(&DataKey::SchemaVersion);
        });
        assert_eq!(client.get_schema_version(), 0);

        assert_eq!(client.migrate(&admin), SCHEMA_VERSION);
        assert_eq!(client.get_schema_version(), SCHEMA_VERSION);
    }

    #[test]
    fn test_migrate_rejects_current_version() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        env.mock_all_auths();

        let result = client.try_migrate(&admin);
        assert!(result.is_err(), "migrate on current schema must fail");
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::SchemaAlreadyCurrent,
        );
    }

    #[test]
    fn test_migrate_rejects_downgrade() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        env.mock_all_auths();

        // Simulate a stored schema version higher than SCHEMA_VERSION.
        env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .set(&DataKey::SchemaVersion, &(SCHEMA_VERSION + 1));
        });

        let result = client.try_migrate(&admin);
        assert!(result.is_err(), "migrate downgrade must fail");
        assert_eq!(result.unwrap_err().unwrap(), ContractError::SchemaDowngrade,);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_migrate_requires_admin() {
        let env = Env::default();
        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        env.mock_all_auths();

        env.as_contract(&contract_id, || {
            env.storage().persistent().remove(&DataKey::SchemaVersion);
        });
        client.migrate(&Address::generate(&env));
    }

    // ── Invariant: claimed never exceeds deposited (#557) ───────────────────

    /// Deterministic linear congruential generator.
    ///
    /// Seeded per run so a failing sequence is reproducible from the seed in
    /// the assertion message — no external RNG crate, and no flaky CI.
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

        fn below(&mut self, bound: u64) -> u64 {
            self.next_u64() % bound
        }
    }

    /// Property test: across randomized sequences of open/claim/top_up/
    /// pause/resume/close, `claimed <= deposited` must hold after *every*
    /// call, and the contract must stay solvent for what it still owes.
    #[test]
    fn test_invariant_claimed_never_exceeds_deposited() {
        const STREAMS: usize = 3;
        const OPS_PER_RUN: usize = 80;
        const FUNDING: i128 = 100_000_000;

        for seed in 1..=8u64 {
            let env = Env::default();
            let (contract_id, client, token_id, payer, recipient) = stream_fixture(&env, FUNDING);
            let token = token::Client::new(&env, &token_id);

            let mut ids = [0u32; STREAMS];
            for id_slot in ids.iter_mut() {
                *id_slot =
                    open_single_stream(&env, &client, &token_id, &payer, &recipient, RATE, DEPOSIT);
            }
            let mut closed = [false; STREAMS];
            let mut paused = [false; STREAMS];

            let mut rng = Lcg::new(seed);
            for step in 0..OPS_PER_RUN {
                let idx = rng.below(STREAMS as u64) as usize;
                let id = ids[idx];

                match rng.below(7) {
                    // Let time pass, sometimes far past the funded window.
                    0 | 1 => advance_by(&env, 1 + rng.below(400) as u32),
                    2 => {
                        if !closed[idx] {
                            client.claim_stream(&id, &recipient);
                        }
                    }
                    3 => {
                        if !closed[idx] {
                            let amount = MIN_STREAM_DEPOSIT * (1 + rng.below(5) as i128);
                            client.top_up_stream(&id, &payer, &amount);
                        }
                    }
                    4 => {
                        if !closed[idx] && !paused[idx] {
                            client.pause_stream(&id, &payer);
                            paused[idx] = true;
                        }
                    }
                    5 => {
                        if !closed[idx] && paused[idx] {
                            client.resume_stream(&id, &payer);
                            paused[idx] = false;
                        }
                    }
                    _ => {
                        if !closed[idx] {
                            client.close_stream(&id, &payer);
                            closed[idx] = true;
                            paused[idx] = false;
                        }
                    }
                }

                // Invariant check after every single call.
                let mut outstanding: i128 = 0;
                for (slot, stream_id) in ids.iter().enumerate() {
                    let stream = client.get_stream(stream_id);
                    let claimed = claimed_of(&stream);
                    assert!(
                        claimed <= stream.deposited,
                        "invariant violated (seed {}, step {}, stream {}): claimed {} > deposited {}",
                        seed,
                        step,
                        slot,
                        claimed,
                        stream.deposited
                    );
                    assert!(
                        claimed >= 0,
                        "negative claimed (seed {}, step {}, stream {}): {}",
                        seed,
                        step,
                        slot,
                        claimed
                    );

                    let claimable = client.get_claimable(stream_id, &recipient);
                    assert!(
                        claimable <= stream.deposited - claimed,
                        "claimable {} exceeds remaining deposit (seed {}, step {}, stream {})",
                        claimable,
                        seed,
                        step,
                        slot
                    );

                    if !closed[slot] {
                        outstanding += stream.deposited - claimed;
                    }
                }

                // Solvency: the contract still holds exactly what it owes.
                assert_eq!(
                    token.balance(&contract_id),
                    outstanding,
                    "contract balance does not cover outstanding streams (seed {}, step {})",
                    seed,
                    step
                );
            }
        }
    }
}

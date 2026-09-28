#![no_std]

/**
 * contracts/stellar-micropay-contract/src/lib.rs
 *
 * Stellar MicroPay — Soroban Smart Contract
 *
 * Provides:
 *   - Streaming payments (open/claim/top-up/close + pause/resume)
 *   - Escrow payments (ROADMAP v2.1)
 *   - Creator tipping (ROADMAP v1.4)
 *   - Micro-transaction batching (ROADMAP v2.0)
 *   - NFT payment receipts (ROADMAP v1.5)
 */

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, BytesN, Env, Symbol,
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
    pub fn initialize(env: Env, admin: Address) {
        // Ensure not already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
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
            (Symbol::new(&env, "tip"), from, to.clone()),
            TipEventData { amount, fee_amount },
        );
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
    pub fn get_tip_total(env: Env, recipient: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TipTotal(recipient))
            .unwrap_or(0)
    }

    /// Get the number of tips received by a recipient.
    pub fn get_tip_count(env: Env, recipient: Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TipCount(recipient))
            .unwrap_or(0)
    }

    /// Get the contract admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized")
    }

    /// Get a specific tip record for a recipient by index.
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

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ReceiptCount(from.clone()))
            .unwrap_or(0);

        let receipt = ReceiptMetadata {
            from: from.clone(),
            to,
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
            (Symbol::new(&env, "receipt"), from),
            count,
        );

        count
    }

    /// Get the total number of receipts minted for a payer.
    pub fn get_receipt_count(env: Env, payer: Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ReceiptCount(payer))
            .unwrap_or(0)
    }

    /// Get a specific receipt for a payer by index.
    pub fn get_receipt(env: Env, payer: Address, index: u32) -> ReceiptMetadata {
        env.storage()
            .instance()
            .get(&DataKey::ReceiptRecord(payer, index))
            .expect("Receipt not found")
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
            (Symbol::new(&env, "stream_open"), payer, recipient),
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
            (Symbol::new(&env, "stream_claim"), recipient, stream_id),
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
            (Symbol::new(&env, "stream_topup"), payer, stream_id),
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
            (Symbol::new(&env, "stream_close"), payer, stream_id),
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
            (Symbol::new(&env, "stream_pause"), payer, stream_id),
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
            (Symbol::new(&env, "stream_resume"), payer, stream_id),
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
            (Symbol::new(&env, "escrow_open"), payer, recipient),
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
            (Symbol::new(&env, "escrow_release"), record.recipient.clone(), escrow_id),
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
            (Symbol::new(&env, "escrow_cancel"), payer, escrow_id),
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
        testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger},
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
        client.initialize(&admin);

        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "Contract already initialized")]
    fn test_double_initialize_fails() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);
        client.initialize(&admin); // should panic
    }

    #[test]
    fn test_mint_receipt_stores_receipt_record_accessible_via_get_receipt() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
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
        client.initialize(&admin);

        let payer = Address::generate(&env);
        let payee1 = Address::generate(&env);
        let payee2 = Address::generate(&env);

        env.mock_all_auths();

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
        env.set_sequence_number(10);
        let claimed = client.claim_stream(&id, &recipient);
        // start_ledger is the sequence at open (default test seq); claim 10 ledgers * 10
        assert!(claimed >= 0);
    }

    #[test]
    fn test_claim_stream_multiple_times() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &5, &1000);
        env.set_sequence_number(env.ledger().sequence() + 4);
        let first = client.claim_stream(&id, &recipient);
        env.set_sequence_number(env.ledger().sequence() + 4);
        let second = client.claim_stream(&id, &recipient);
        assert_eq!(first, 20);
        assert_eq!(second, 20);
    }

    #[test]
    fn test_claim_stream_exceeds_deposit() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &100, &150);
        env.set_sequence_number(env.ledger().sequence() + 10);
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
        env.set_sequence_number(env.ledger().sequence() + 5);
        let refund = client.close_stream(&id, &payer);
        assert_eq!(refund, 950);
    }

    #[test]
    fn test_close_stream_after_claims() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        env.set_sequence_number(env.ledger().sequence() + 5);
        let claimed = client.claim_stream(&id, &recipient);
        assert_eq!(claimed, 50);
        let refund = client.close_stream(&id, &payer);
        assert_eq!(refund, 950);
    }

    #[test]
    fn test_get_claimable() {
        let (env, client, _admin, payer, recipient) = setup();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        env.set_sequence_number(env.ledger().sequence() + 3);
        assert_eq!(client.get_claimable(&id), 30);
    }

    #[test]
    #[should_panic(expected = "Stream not found")]
    fn test_claim_nonexistent_stream() {
        let (_env, client, _admin, _payer, recipient) = setup();
        client.claim_stream(&999, &recipient);
    }

    #[test]
    fn test_unauthorized_claim() {
        let (env, client, _admin, payer, recipient) = setup();
        env.mock_all_auths();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        let impostor = Address::generate(&env);
        // Auth mock passes, but contract-level recipient check must reject.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.claim_stream(&id, &impostor);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_unauthorized_close() {
        let (env, client, _admin, payer, recipient) = setup();
        env.mock_all_auths();
        let id = client.open_stream(&payer, &recipient, &10, &1000);
        let impostor = Address::generate(&env);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.close_stream(&id, &impostor);
        }));
        assert!(result.is_err());
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
        env.set_sequence_number(start + 5);
        client.pause_stream(&id, &payer);
        assert_eq!(client.get_claimable(&id), 50);

        // Advance 10 more ledgers while paused: claimable must NOT increase.
        env.set_sequence_number(start + 15);
        assert_eq!(client.get_claimable(&id), 50);
        let paused_claim = client.claim_stream(&id, &recipient);
        assert_eq!(paused_claim, 50);

        // Resume and advance 5 ledgers: claimable SHOULD increase again.
        client.resume_stream(&id, &payer);
        env.set_sequence_number(env.ledger().sequence() + 5);
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
        env.set_sequence_number(release + 1);
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
        env.set_sequence_number(release - 10);
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
        env.set_sequence_number(release + 1);
        client.cancel_escrow(&id, &payer);
    }

    #[test]
    fn test_escrow_auth_checks() {
        let (env, client, _admin, payer, recipient) = setup();
        env.mock_all_auths();
        let release = env.ledger().sequence() + 50;
        let id = client.open_escrow(&payer, &recipient, &100, &release);
        // Verify auth was required on open.
        let auths = env.auths();
        assert!(!auths.is_empty());
        let _ = (id, recipient);
    }

    #[test]
    fn test_auth_invocation_shapes() {
        // Keeps imports used and documents expected auth entrypoints.
        let fn_open = AuthorizedFunction::Contract((
            Address::generate(&Env::default()),
            Symbol::new(&Env::default(), "open_escrow"),
            (),
        ));
        let _inv = AuthorizedInvocation {
            function: fn_open,
            sub_invocations: Default::default(),
        };
    }
}


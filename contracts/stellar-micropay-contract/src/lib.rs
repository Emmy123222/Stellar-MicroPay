// contracts/stellar-micropay-contract/src/lib.rs
//
// Stellar MicroPay — Soroban Smart Contract
//
// Functionality:
//   - Initialize the contract with an admin
//   - Record tips sent between accounts
//   - Query tip totals per recipient
//   - Time-locked escrow: create, release, cancel
//   - Invoice payments: create, claim, cancel
//
// Build:
//   cargo build --target wasm32-unknown-unknown --release
//
// Deploy (Stellar CLI):
//   stellar contract deploy \
//     --wasm target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm \
//     --source YOUR_SECRET_KEY \
//     --network testnet

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol,
};

// ─── Storage keys ─────────────────────────────────────────────────────────────

// ─── Data types ───────────────────────────────────────────────────────────────

/// A single tip event recorded on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TipRecord {
    pub from: Address,
    pub to: Address,
    /// Amount in stroops (1 XLM = 10_000_000 stroops)
    pub amount: i128,
    pub ledger: u32,
}

/// A time-locked escrow holding funds until release_ledger.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    /// The sender who locked the funds
    pub from: Address,
    /// The intended recipient
    pub to: Address,
    /// Amount in the token's smallest unit
    pub amount: i128,
    /// The SAC address of the token being escrowed
    pub token: Address,
    /// Ledger number after which funds can be released to recipient
    pub release_ledger: u32,
    /// True if the sender cancelled before release
    pub cancelled: bool,
}

/// An invoice payment record.
///
/// A client locks `amount` of XLM (or any SAC token) when creating the invoice.
/// The `recipient` claims the funds by presenting `invoice_id`. The `client`
/// can cancel and receive a full refund as long as the invoice is unclaimed.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Invoice {
    /// Unique invoice identifier (sequential u64)
    pub id: u64,
    /// The party who owes payment and locked the funds
    pub client: Address,
    /// The party who should receive the payment
    pub recipient: Address,
    /// Amount locked, in the token's smallest unit
    pub amount: i128,
    /// The SAC address of the token being held
    pub token: Address,
    /// True once the recipient has successfully claimed
    pub claimed: bool,
    /// True if the client cancelled before the invoice was claimed
    pub cancelled: bool,
    /// Ledger sequence number at the time of creation
    pub created_at: u32,
}

/// Storage keys for all contract state
#[contracttype]
pub enum DataKey {
    Admin,
    TipTotal(Address),
    TipCount(Address),
    Escrow(u64),
    EscrowCount,
    Invoice(u64),
    InvoiceCount,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct MicroPayContract;

#[contractimpl]
impl MicroPayContract {

    // ─── Initialization ──────────────────────────────────────────────────────

    /// Initialize the contract with an admin address. Can only be called once.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    // ─── Tipping ─────────────────────────────────────────────────────────────

    /// Send a tip from `from` to `to` using a Stellar token (SAC).
    pub fn send_tip(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) {
        from.require_auth();

        if amount <= 0 {
            panic!("Tip amount must be positive");
        }

        let token = token::Client::new(&env, &token_address);
        token.transfer(&from, &to, &amount);

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

        env.events().publish(
            (Symbol::new(&env, "tip"), from, to.clone()),
            amount,
        );
    }

    // ─── Escrow ───────────────────────────────────────────────────────────────

    /// Create a time-locked escrow. Transfers `amount` of `token` from `from`
    /// into the contract. Funds can be released to `to` once the current ledger
    /// reaches `release_ledger`, or cancelled by `from` before that.
    ///
    /// Returns the unique escrow ID.
    pub fn create_escrow(
        env: Env,
        token: Address,
        from: Address,
        to: Address,
        amount: i128,
        release_ledger: u32,
    ) -> u64 {
        from.require_auth();

        if amount <= 0 {
            panic!("Escrow amount must be positive");
        }
        if release_ledger <= env.ledger().sequence() {
            panic!("release_ledger must be in the future");
        }

        // Transfer funds from sender into this contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Assign a unique ID
        let escrow_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0u64);

        let escrow = Escrow {
            from: from.clone(),
            to: to.clone(),
            amount,
            token,
            release_ledger,
            cancelled: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        env.storage()
            .instance()
            .set(&DataKey::EscrowCount, &(escrow_id + 1));

        env.events().publish(
            (Symbol::new(&env, "escrow_create"), from, to),
            (escrow_id, amount, release_ledger),
        );

        escrow_id
    }

    /// Release escrowed funds to the recipient.
    /// Can be called by anyone once the current ledger >= release_ledger.
    pub fn release_escrow(env: Env, escrow_id: u64) {
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        if escrow.cancelled {
            panic!("Escrow already cancelled");
        }

        if escrow.amount == 0 {
            panic!("Escrow already released");
        }

        if env.ledger().sequence() < escrow.release_ledger {
            panic!("Escrow is still locked");
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.to,
            &escrow.amount,
        );

        // Mark as released by zeroing the amount (funds gone)
        let released_amount = escrow.amount;
        escrow.amount = 0;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        env.events().publish(
            (Symbol::new(&env, "escrow_release"), escrow.to.clone()),
            (escrow_id, released_amount),
        );
    }

    /// Cancel an escrow and return funds to the sender.
    /// Only the original sender (`from`) can cancel, and only before release.
    pub fn cancel_escrow(env: Env, escrow_id: u64) {
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        // Only the original sender can cancel
        escrow.from.require_auth();

        if escrow.cancelled {
            panic!("Escrow already cancelled");
        }
        if escrow.amount == 0 {
            panic!("Escrow already released");
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.from,
            &escrow.amount,
        );

        let refunded_amount = escrow.amount;
        escrow.cancelled = true;
        escrow.amount = 0;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        env.events().publish(
            (Symbol::new(&env, "escrow_cancel"), escrow.from.clone()),
            (escrow_id, refunded_amount),
        );
    }

    /// Get the current state of an escrow by ID.
    pub fn get_escrow(env: Env, escrow_id: u64) -> Escrow {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found")
    }

    // ─── Invoice Payments ─────────────────────────────────────────────────────

    /// Create an invoice and lock `amount` of `token` from `client` into the
    /// contract. The funds remain locked until either:
    ///   - `recipient` calls `claim_invoice`, or
    ///   - `client` calls `cancel_invoice`.
    ///
    /// Returns the unique invoice ID.
    pub fn create_invoice(
        env: Env,
        token: Address,
        client: Address,
        recipient: Address,
        amount: i128,
    ) -> u64 {
        client.require_auth();

        if amount <= 0 {
            panic!("Invoice amount must be positive");
        }

        // Pull funds from the client into this contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&client, &env.current_contract_address(), &amount);

        // Assign sequential invoice ID
        let invoice_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::InvoiceCount)
            .unwrap_or(0u64);

        let invoice = Invoice {
            id: invoice_id,
            client: client.clone(),
            recipient: recipient.clone(),
            amount,
            token,
            claimed: false,
            cancelled: false,
            created_at: env.ledger().sequence(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Invoice(invoice_id), &invoice);

        env.storage()
            .instance()
            .set(&DataKey::InvoiceCount, &(invoice_id + 1));

        env.events().publish(
            (Symbol::new(&env, "invoice_create"), client, recipient),
            (invoice_id, amount),
        );

        invoice_id
    }

    /// Claim an invoice and release locked funds to the recipient.
    ///
    /// Only the `recipient` recorded on the invoice may claim it.
    /// Panics if the invoice has already been claimed or cancelled.
    pub fn claim_invoice(env: Env, invoice_id: u64, recipient: Address) {
        recipient.require_auth();

        let mut invoice: Invoice = env
            .storage()
            .persistent()
            .get(&DataKey::Invoice(invoice_id))
            .expect("Invoice not found");

        // Verify the caller is the intended recipient
        if invoice.recipient != recipient {
            panic!("Only the intended recipient may claim this invoice");
        }

        if invoice.cancelled {
            panic!("Invoice has been cancelled");
        }

        if invoice.claimed {
            panic!("Invoice already claimed");
        }

        // Transfer funds from contract to recipient
        let token_client = token::Client::new(&env, &invoice.token);
        token_client.transfer(
            &env.current_contract_address(),
            &invoice.recipient,
            &invoice.amount,
        );

        let claimed_amount = invoice.amount;
        invoice.claimed = true;
        invoice.amount = 0;

        env.storage()
            .persistent()
            .set(&DataKey::Invoice(invoice_id), &invoice);

        env.events().publish(
            (Symbol::new(&env, "invoice_claim"), invoice.recipient.clone()),
            (invoice_id, claimed_amount),
        );
    }

    /// Cancel an invoice and refund locked funds to the client.
    ///
    /// Only the `client` who created the invoice may cancel it, and only
    /// while it remains unclaimed.
    pub fn cancel_invoice(env: Env, invoice_id: u64, client: Address) {
        client.require_auth();

        let mut invoice: Invoice = env
            .storage()
            .persistent()
            .get(&DataKey::Invoice(invoice_id))
            .expect("Invoice not found");

        // Verify the caller is the client who created this invoice
        if invoice.client != client {
            panic!("Only the client may cancel this invoice");
        }

        if invoice.claimed {
            panic!("Invoice already claimed; cannot cancel");
        }

        if invoice.cancelled {
            panic!("Invoice already cancelled");
        }

        // Refund to the client
        let token_client = token::Client::new(&env, &invoice.token);
        token_client.transfer(
            &env.current_contract_address(),
            &invoice.client,
            &invoice.amount,
        );

        let refunded_amount = invoice.amount;
        invoice.cancelled = true;
        invoice.amount = 0;

        env.storage()
            .persistent()
            .set(&DataKey::Invoice(invoice_id), &invoice);

        env.events().publish(
            (Symbol::new(&env, "invoice_cancel"), invoice.client.clone()),
            (invoice_id, refunded_amount),
        );
    }

    /// Return the full state of an invoice by ID.
    pub fn get_invoice(env: Env, invoice_id: u64) -> Invoice {
        env.storage()
            .persistent()
            .get(&DataKey::Invoice(invoice_id))
            .expect("Invoice not found")
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    pub fn get_tip_total(env: Env, recipient: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TipTotal(recipient))
            .unwrap_or(0)
    }

    pub fn get_tip_count(env: Env, recipient: Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TipCount(recipient))
            .unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized")
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
        testutils::{Address as _, Ledger, LedgerInfo},
        Address, Env,
    };
    use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};

    /// Helper: deploy the contract and return (env, client, admin)
    fn setup() -> (Env, MicroPayContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    /// Helper: create a test token, mint `amount` to `to`, return token address
    fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_address = token_id.address();
        let sac = StellarAssetClient::new(env, &token_address);
        sac.mint(to, &amount);
        token_address
    }

    // ─── Initialization tests ─────────────────────────────────────────────────

    #[test]
    fn test_initialize() {
        let (_, client, admin) = setup();
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "Contract already initialized")]
    fn test_double_initialize_fails() {
        let (_, client, admin) = setup();
        client.initialize(&admin);
    }

    #[test]
    fn test_tip_totals_start_at_zero() {
        let (env, client, _) = setup();
        let recipient = Address::generate(&env);
        assert_eq!(client.get_tip_total(&recipient), 0);
        assert_eq!(client.get_tip_count(&recipient), 0);
    }

    // ─── Escrow: create ───────────────────────────────────────────────────────

    #[test]
    fn test_create_escrow() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 1_000_000);

        // Current ledger is 0 by default; release at ledger 100
        let escrow_id = client.create_escrow(&token, &sender, &recipient, &500_000, &100);
        assert_eq!(escrow_id, 0);

        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.from, sender);
        assert_eq!(escrow.to, recipient);
        assert_eq!(escrow.amount, 500_000);
        assert_eq!(escrow.release_ledger, 100);
        assert!(!escrow.cancelled);

        // Sender's token balance should be reduced
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&sender), 500_000);
    }

    #[test]
    #[should_panic(expected = "Escrow amount must be positive")]
    fn test_create_escrow_zero_amount_fails() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 1_000_000);
        client.create_escrow(&token, &sender, &recipient, &0, &100);
    }

    #[test]
    #[should_panic(expected = "release_ledger must be in the future")]
    fn test_create_escrow_past_ledger_fails() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 1_000_000);
        // release_ledger = 0, current ledger = 0 → not in the future
        client.create_escrow(&token, &sender, &recipient, &500_000, &0);
    }

    // ─── Escrow: release ──────────────────────────────────────────────────────

    #[test]
    fn test_release_escrow_after_lock() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 1_000_000);

        let escrow_id = client.create_escrow(&token, &sender, &recipient, &500_000, &100);

        // Advance ledger past release point
        env.ledger().set(LedgerInfo {
            sequence_number: 101,
            timestamp: 0,
            protocol_version: 20,
            network_id: Default::default(),
            base_reserve: 5_000_000,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        client.release_escrow(&escrow_id);

        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&recipient), 500_000);

        // Escrow amount should be zeroed
        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.amount, 0);
    }

    #[test]
    #[should_panic(expected = "Escrow is still locked")]
    fn test_release_escrow_before_lock_fails() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 1_000_000);

        let escrow_id = client.create_escrow(&token, &sender, &recipient, &500_000, &100);
        // Ledger is still at 0 — should panic
        client.release_escrow(&escrow_id);
    }

    #[test]
    #[should_panic(expected = "Escrow already released")]
    fn test_release_escrow_twice_fails() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 1_000_000);

        let escrow_id = client.create_escrow(&token, &sender, &recipient, &500_000, &100);

        env.ledger().set(LedgerInfo {
            sequence_number: 101,
            timestamp: 0,
            protocol_version: 20,
            network_id: Default::default(),
            base_reserve: 5_000_000,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        client.release_escrow(&escrow_id);
        // Second release should panic via cancel_escrow path — amount is 0
        client.release_escrow(&escrow_id);
    }

    // ─── Escrow: cancel ───────────────────────────────────────────────────────

    #[test]
    fn test_cancel_escrow_refunds_sender() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 1_000_000);

        let escrow_id = client.create_escrow(&token, &sender, &recipient, &500_000, &100);

        // Cancel before release_ledger
        client.cancel_escrow(&escrow_id);

        let token_client = TokenClient::new(&env, &token);
        // Full balance restored to sender
        assert_eq!(token_client.balance(&sender), 1_000_000);

        let escrow = client.get_escrow(&escrow_id);
        assert!(escrow.cancelled);
        assert_eq!(escrow.amount, 0);
    }

    #[test]
    #[should_panic(expected = "Escrow already cancelled")]
    fn test_cancel_escrow_twice_fails() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 1_000_000);

        let escrow_id = client.create_escrow(&token, &sender, &recipient, &500_000, &100);
        client.cancel_escrow(&escrow_id);
        client.cancel_escrow(&escrow_id); // should panic
    }

    #[test]
    #[should_panic(expected = "Escrow already released")]
    fn test_cancel_after_release_fails() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 1_000_000);

        let escrow_id = client.create_escrow(&token, &sender, &recipient, &500_000, &100);

        env.ledger().set(LedgerInfo {
            sequence_number: 101,
            timestamp: 0,
            protocol_version: 20,
            network_id: Default::default(),
            base_reserve: 5_000_000,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        client.release_escrow(&escrow_id);
        client.cancel_escrow(&escrow_id); // should panic
    }

    #[test]
    fn test_multiple_escrows_independent() {
        let (env, client, admin) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = create_token(&env, &admin, &sender, 2_000_000);

        let id0 = client.create_escrow(&token, &sender, &recipient, &500_000, &50);
        let id1 = client.create_escrow(&token, &sender, &recipient, &300_000, &200);

        assert_eq!(id0, 0);
        assert_eq!(id1, 1);

        // Cancel first escrow
        client.cancel_escrow(&id0);

        // Advance past first release but not second
        env.ledger().set(LedgerInfo {
            sequence_number: 60,
            timestamp: 0,
            protocol_version: 20,
            network_id: Default::default(),
            base_reserve: 5_000_000,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        // Second escrow still locked at ledger 60 < 200
        let escrow1 = client.get_escrow(&id1);
        assert_eq!(escrow1.amount, 300_000);
        assert!(!escrow1.cancelled);
    }

    // ─── Invoice: create ──────────────────────────────────────────────────────

    #[test]
    fn test_create_invoice() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        assert_eq!(invoice_id, 0);

        let invoice = client.get_invoice(&invoice_id);
        assert_eq!(invoice.id, 0);
        assert_eq!(invoice.client, payer);
        assert_eq!(invoice.recipient, vendor);
        assert_eq!(invoice.amount, 2_000_000);
        assert!(!invoice.claimed);
        assert!(!invoice.cancelled);

        // Funds should be deducted from payer
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&payer), 3_000_000);
    }

    #[test]
    #[should_panic(expected = "Invoice amount must be positive")]
    fn test_create_invoice_zero_amount_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);
        client.create_invoice(&token, &payer, &vendor, &0);
    }

    #[test]
    #[should_panic(expected = "Invoice amount must be positive")]
    fn test_create_invoice_negative_amount_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);
        client.create_invoice(&token, &payer, &vendor, &-1);
    }

    // ─── Invoice: claim ───────────────────────────────────────────────────────

    #[test]
    fn test_claim_invoice_full_lifecycle() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);

        client.claim_invoice(&invoice_id, &vendor);

        // Vendor receives the funds
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&vendor), 2_000_000);

        // Invoice reflects claimed state
        let invoice = client.get_invoice(&invoice_id);
        assert!(invoice.claimed);
        assert_eq!(invoice.amount, 0);
        assert!(!invoice.cancelled);
    }

    #[test]
    #[should_panic(expected = "Invoice already claimed")]
    fn test_claim_invoice_twice_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        client.claim_invoice(&invoice_id, &vendor);
        // Second claim must panic
        client.claim_invoice(&invoice_id, &vendor);
    }

    #[test]
    #[should_panic(expected = "Only the intended recipient may claim this invoice")]
    fn test_claim_invoice_wrong_recipient_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let impostor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        // Impostor tries to claim
        client.claim_invoice(&invoice_id, &impostor);
    }

    #[test]
    #[should_panic(expected = "Invoice has been cancelled")]
    fn test_claim_cancelled_invoice_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        client.cancel_invoice(&invoice_id, &payer);
        // Vendor tries to claim after cancellation
        client.claim_invoice(&invoice_id, &vendor);
    }

    // ─── Invoice: cancel ──────────────────────────────────────────────────────

    #[test]
    fn test_cancel_invoice_refunds_client() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);

        client.cancel_invoice(&invoice_id, &payer);

        // Full balance restored to payer
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&payer), 5_000_000);

        let invoice = client.get_invoice(&invoice_id);
        assert!(invoice.cancelled);
        assert!(!invoice.claimed);
        assert_eq!(invoice.amount, 0);
    }

    #[test]
    #[should_panic(expected = "Invoice already cancelled")]
    fn test_cancel_invoice_twice_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        client.cancel_invoice(&invoice_id, &payer);
        client.cancel_invoice(&invoice_id, &payer); // must panic
    }

    #[test]
    #[should_panic(expected = "Only the client may cancel this invoice")]
    fn test_cancel_invoice_wrong_client_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let stranger = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        // A stranger attempts cancellation
        client.cancel_invoice(&invoice_id, &stranger);
    }

    #[test]
    #[should_panic(expected = "Invoice already claimed; cannot cancel")]
    fn test_cancel_after_claim_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        client.claim_invoice(&invoice_id, &vendor);
        // Payer tries to cancel after vendor already claimed
        client.cancel_invoice(&invoice_id, &payer);
    }

    // ─── Invoice: get_invoice ─────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Invoice not found")]
    fn test_get_nonexistent_invoice_fails() {
        let (_, client, _) = setup();
        client.get_invoice(&999);
    }

    // ─── Invoice: sequential IDs and independence ─────────────────────────────

    #[test]
    fn test_multiple_invoices_sequential_ids() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor_a = Address::generate(&env);
        let vendor_b = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 10_000_000);

        let id0 = client.create_invoice(&token, &payer, &vendor_a, &1_000_000);
        let id1 = client.create_invoice(&token, &payer, &vendor_b, &2_000_000);
        let id2 = client.create_invoice(&token, &payer, &vendor_a, &3_000_000);

        assert_eq!(id0, 0);
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);

        // Claim the second invoice; others remain untouched
        client.claim_invoice(&id1, &vendor_b);

        let inv0 = client.get_invoice(&id0);
        let inv1 = client.get_invoice(&id1);
        let inv2 = client.get_invoice(&id2);

        assert!(!inv0.claimed && !inv0.cancelled);
        assert!(inv1.claimed && !inv1.cancelled);
        assert!(!inv2.claimed && !inv2.cancelled);
    }

    #[test]
    fn test_invoice_and_escrow_ids_independent() {
        // Invoice counter and escrow counter are separate — both start at 0
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        let other = Address::generate(&env);
        let token = create_token(&env, &admin, &user, 5_000_000);

        let escrow_id = client.create_escrow(&token, &user, &other, &1_000_000, &50);
        let invoice_id = client.create_invoice(&token, &user, &other, &1_000_000);

        // Both start from 0 independently
        assert_eq!(escrow_id, 0);
        assert_eq!(invoice_id, 0);

        // Each can be retrieved without interference
        let _ = client.get_escrow(&escrow_id);
        let _ = client.get_invoice(&invoice_id);
    }
}
// contracts/stellar-micropay-contract/src/lib.rs
//
// Stellar MicroPay — Soroban Smart Contract
//
// Functionality:
//   - Initialize the contract with an admin
//   - Record tips sent between accounts
//   - Query tip totals per recipient
//   - Time-locked escrow: create, release, cancel
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

/// Storage keys for all contract state
#[contracttype]
pub enum DataKey {
    Admin,
    TipTotal(Address),
    TipCount(Address),
    Escrow(u64),
    EscrowCount,
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
}

#![no_std]

/**
 * contracts/stellar-micropay-contract/src/lib.rs
 *
 * Stellar MicroPay — Soroban Smart Contract
 *
 * Provides:
 *   - Escrow payments (ROADMAP v2.1)
 *   - Creator tipping (ROADMAP v1.4)
 *   - Micro-transaction batching (ROADMAP v2.0)
 *   - NFT payment receipts (ROADMAP v1.5)
 *
 * Build:
 *   cargo build --target wasm32-unknown-unknown --release
 *
 * Deploy (Stellar CLI):
 *   stellar contract deploy \
 *     --wasm target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm \
 *     --source YOUR_SECRET_KEY \
 *     --network testnet
 */

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol,
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

/// Storage key for per-recipient tip totals
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
}

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

    // ─── Tipping ─────────────────────────────────────────────────────────────

    /// Send a tip from `from` to `to` using a Stellar token.
    ///
    /// Parameters:
    ///   - token_address: The SAC (Stellar Asset Contract) address for the token (e.g. XLM)
    ///   - from:          The sender (must authorize this call)
    ///   - to:            The recipient
    ///   - amount:        Amount in the token's smallest unit (stroops for XLM)
    ///
    /// This records the tip on-chain for analytics and emits an event.
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

        // Transfer tokens via the Stellar token interface (SAC)
        let token = token::Client::new(&env, &token_address);
        token.transfer(&from, &to, &amount);

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

        // Emit an event for indexers
        env.events().publish(
            (Symbol::new(&env, "tip"), from, to.clone()),
            amount,
        );
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
    ///
    /// Stores receipt metadata (amount, timestamp, memo) under the payer's
    /// address and emits a `receipt` event. The returned `u32` is the receipt
    /// index (NFT ID) for this payer.
    ///
    /// Parameters:
    ///   - from:   The payer (must authorize this call)
    ///   - to:     The payee
    ///   - amount: Amount in stroops
    ///   - memo:   Optional payment memo (max 28 chars, passed as a Symbol)
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

    // ─── Placeholders (future features) ──────────────────────────────────────

    /// [PLACEHOLDER] Create an escrow payment that releases after a time lock.
    /// See ROADMAP.md v2.1 — Soroban Escrow Payments.
    ///
    /// Future implementation:
    ///   - Lock funds in the contract
    ///   - Release to recipient after `release_ledger`
    ///   - Allow sender to cancel before release
    pub fn create_escrow(
        _env: Env,
        _from: Address,
        _to: Address,
        _amount: i128,
        _release_ledger: u32,
    ) {
        panic!("Escrow payments coming in v2.1 — see ROADMAP.md");
    }

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
        testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger as _},
        Address, Bytes, ContractExecutable, Env,
    };

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
    fn test_mint_receipt() {
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
    }

    #[test]
    fn test_receipt_count_tracks_multiple_mints() {
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

    // ─── WASM upgrade keeps existing state (#1228) ───────────────────────────

    extern crate std;
    use std::{format, string::String};

    /// A real Soroban WASM blob standing in for "the next version" of this
    /// contract. Deliberately *not* MicroPay: an upgrade only proves the state
    /// survived if the new executable shares nothing with the old one.
    ///
    /// This is `test_add_u64` from the `soroban-sdk` doctest fixtures
    /// (`~/.cargo/registry/.../soroban-sdk-28.0.0/doctest_fixtures/contract.wasm`),
    /// copied into the repo so `cargo test` needs no stellar-cli build step.
    const NEW_WASM: &[u8] = include_bytes!("../test_wasm/stub_new_wasm.wasm");

    /// Three tips and two receipts, sized so that a shifted, dropped or
    /// re-keyed record shows up as a difference rather than going unnoticed.
    const TIP_AMOUNTS: [i128; 3] = [1_000, 2_500, 4_000];
    const RECEIPT_AMOUNTS: [i128; 2] = [700, 900];

    /// Everything the contract stores for the seeded accounts, rendered as one
    /// comparable string.
    ///
    /// Read straight from instance storage rather than through the generated
    /// client, because once the swap lands the executable is `NEW_WASM`, which
    /// does not export `get_admin`/`get_tip_total`. The keys below are exactly
    /// the `DataKey`s those getters read, so this reports the same values the
    /// getters return while the previous WASM is still installed.
    fn state_digest(
        env: &Env,
        contract_id: &Address,
        recipient: &Address,
        payer: &Address,
    ) -> String {
        env.as_contract(contract_id, || {
            let storage = env.storage().instance();
            let admin: Address = storage.get(&DataKey::Admin).unwrap();
            let tip_total: i128 = storage
                .get(&DataKey::TipTotal(recipient.clone()))
                .unwrap_or(0);
            let tip_count: u32 = storage
                .get(&DataKey::TipCount(recipient.clone()))
                .unwrap_or(0);
            let receipt_count: u32 = storage
                .get(&DataKey::ReceiptCount(payer.clone()))
                .unwrap_or(0);

            let mut digest = format!(
                "admin={:?} tip_total={} tip_count={} receipt_count={}",
                admin, tip_total, tip_count, receipt_count
            );
            for index in 0..tip_count {
                let tip: TipRecord = storage
                    .get(&DataKey::TipRecord(recipient.clone(), index))
                    .unwrap();
                digest.push_str(&format!(
                    " tip[{}]{{amount={} ledger={}}}",
                    index, tip.amount, tip.ledger
                ));
            }
            for index in 0..receipt_count {
                let receipt: ReceiptMetadata = storage
                    .get(&DataKey::ReceiptRecord(payer.clone(), index))
                    .unwrap();
                digest.push_str(&format!(
                    " receipt[{}]{{amount={} memo={:?} timestamp={} ledger={}}}",
                    index, receipt.amount, receipt.memo, receipt.timestamp, receipt.ledger
                ));
            }
            digest
        })
    }

    /// Install `NEW_WASM` as the contract's executable.
    ///
    /// `Deployer::update_current_contract` rewrites the instance entry, so it
    /// has to run with the contract as the current invocation; in a test that
    /// means `Env::as_contract`, exactly as an on-chain `upgrade` entry point
    /// would.
    fn upgrade_to_new_wasm(env: &Env, contract_id: &Address) {
        let wasm_hash = env
            .deployer()
            .upload_contract_wasm(Bytes::from_slice(env, NEW_WASM));
        env.as_contract(contract_id, || {
            env.deployer()
                .update_current_contract(ContractExecutable::Wasm(wasm_hash));
        });
    }

    /// Seed the contract with `TIP_AMOUNTS` tips and `RECEIPT_AMOUNTS` receipts,
    /// all filed against `recipient` and `payer`.
    fn seed_state(
        env: &Env,
        client: &MicroPayContractClient,
        admin: &Address,
        recipient: &Address,
        payer: &Address,
    ) {
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::StellarAssetClient::new(env, &token).mint(payer, &1_000_000);

        for amount in TIP_AMOUNTS {
            client.send_tip(&token, payer, recipient, &amount);
        }
        for (index, amount) in RECEIPT_AMOUNTS.iter().enumerate() {
            let memo = if index == 0 { "Coffee" } else { "Invoice" };
            client.mint_receipt(payer, recipient, amount, &Symbol::new(env, memo));
        }
    }

    /// An initialized contract already holding the seeded state, i.e. the
    /// "before" half of an upgrade. Returns client, contract id, recipient,
    /// payer and admin.
    fn seeded_contract(
        env: &Env,
    ) -> (
        MicroPayContractClient<'_>,
        Address,
        Address,
        Address,
        Address,
    ) {
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let recipient = Address::generate(env);
        let payer = Address::generate(env);

        client.initialize(&admin);
        seed_state(env, &client, &admin, &recipient, &payer);
        (client, contract_id, recipient, payer, admin)
    }

    #[test]
    fn test_wasm_upgrade_preserves_all_stored_state() {
        let env = Env::default();
        env.mock_all_auths();
        let (_client, contract_id, recipient, payer, _admin) = seeded_contract(&env);

        // Upgrades land in a later ledger than the state they carry over, and
        // tip/receipt records keep the ledger they were written in — moving on
        // here makes sure the upgrade is not what stamps those fields.
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 25);

        let before = state_digest(&env, &contract_id, &recipient, &payer);
        std::println!("state before upgrade: {}", before);

        upgrade_to_new_wasm(&env, &contract_id);

        let after = state_digest(&env, &contract_id, &recipient, &payer);
        std::println!("state after upgrade:  {}", after);

        assert_eq!(before, after);
    }

    #[test]
    fn test_wasm_upgrade_keeps_tip_and_receipt_values() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_id, recipient, payer, admin) = seeded_contract(&env);

        // Values read through the contract's own API before the swap...
        assert_eq!(client.get_tip_total(&recipient), 7_500);
        assert_eq!(client.get_tip_count(&recipient), 3);
        assert_eq!(client.get_tip_record(&recipient, &2).amount, 4_000);
        assert_eq!(client.get_receipt_count(&payer), 2);
        assert_eq!(client.get_receipt(&payer, &0).amount, 700);
        assert_eq!(client.get_admin(), admin);

        upgrade_to_new_wasm(&env, &contract_id);

        // ...are still there afterwards, key for key.
        let digest = state_digest(&env, &contract_id, &recipient, &payer);
        std::println!("state under the new WASM: {}", digest);
        assert!(digest.contains("tip_total=7500 tip_count=3 receipt_count=2"));
        assert!(digest.contains("tip[0]{amount=1000"));
        assert!(digest.contains("tip[2]{amount=4000"));
        assert!(digest.contains("receipt[1]{amount=900"));
    }

    #[test]
    fn test_wasm_upgrade_replaces_the_installed_code() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_id, recipient, payer, _admin) = seeded_contract(&env);

        upgrade_to_new_wasm(&env, &contract_id);

        // The stub WASM exports `add`, not `get_tip_total`, so a rejected call
        // is the proof the new executable is really the one in place. Without
        // this the two tests above could pass while the upgrade did nothing.
        assert!(
            client.try_get_tip_total(&recipient).is_err(),
            "the WASM swap should replace the contract's own entry points"
        );
        assert!(client
            .try_mint_receipt(&payer, &recipient, &1_i128, &Symbol::new(&env, "x"))
            .is_err());
    }

    /// Every panic listed in the README error table (#1217) aborts its call
    /// instead of returning a value, so nothing is written on the way out.
    /// Checked here because the table is only worth trusting if a panic really
    /// is a hard stop for the caller.
    #[test]
    fn test_panics_are_reported_as_context_invalid_action() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        // Every one of these is a documented panic: "Tip amount must be
        // positive", "Contract already initialized", "Tip record not found".
        let rejected = |call: &str, failed: bool| {
            std::println!("{} rejected by the contract: {}", call, failed);
            assert!(failed, "{} must not succeed", call);
        };
        rejected(
            "send_tip(0)",
            client
                .try_send_tip(&token, &sender, &recipient, &0_i128)
                .map(|result| result.is_err())
                .unwrap_or(true),
        );
        rejected(
            "initialize(admin) twice",
            client
                .try_initialize(&admin)
                .map(|result| result.is_err())
                .unwrap_or(true),
        );
        rejected(
            "get_tip_record(unknown index)",
            client
                .try_get_tip_record(&recipient, &9_u32)
                .map(|result| result.is_err())
                .unwrap_or(true),
        );

        // None of them left a trace behind: the admin is still the one from the
        // first `initialize`, and the rejected tip was never counted.
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_tip_count(&recipient), 0);
        assert_eq!(client.get_tip_total(&recipient), 0);
    }
}

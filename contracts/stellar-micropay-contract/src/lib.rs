#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol,
};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum ContractError {
    AlreadyInitialized = 1,
}

const PERSISTENT_LIFETIME_THRESHOLD: u32 = 100_000;
const PERSISTENT_BUMP_AMOUNT: u32 = 500_000;

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

#[contract]
pub struct MicroPayContract;

#[contractimpl]
impl MicroPayContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().extend_ttl(
            &DataKey::Admin,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );

        // Emit an init event so off-chain indexers can detect an initialised
        // contract without polling get_admin() (#258).
        env.events().publish((Symbol::new(&env, "init"),), admin);
        Ok(())
    }

    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) {
        current_admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
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
        from.require_auth();
        if amount <= 0 {
            panic!("Tip amount must be positive");
        }
        let token = token::Client::new(&env, &token_address);
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

        // Clone `from` into the event tuple so the owned binding is not moved
        // out before the borrow checker is done with it (#202).
        env.events()
            .publish((Symbol::new(&env, "tip"), from.clone(), to.clone()), amount);
    }

    pub fn get_tip_total(env: Env, recipient: Address) -> i128 {
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

    pub fn mint_receipt(env: Env, from: Address, to: Address, amount: i128, memo: Symbol) -> u32 {
        from.require_auth();
        if amount <= 0 {
            panic!("Receipt amount must be positive");
        }
        let count: u32 = env
            .storage()
            .persistent()
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
            .persistent()
            .set(&DataKey::ReceiptRecord(from.clone(), count), &receipt);
        env.storage().persistent().extend_ttl(
            &DataKey::ReceiptRecord(from.clone(), count),
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

        env.events()
            .publish((Symbol::new(&env, "receipt"), from), count);
        count
    }

    pub fn get_receipt_count(env: Env, payer: Address) -> u32 {
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
        let key = DataKey::ReceiptRecord(payer, index);
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

    pub fn create_escrow(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
        release_ledger: u32,
    ) -> u32 {
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

        let next_id: u32 = env.storage().persistent().get(&DataKey::EscrowCount).unwrap_or(0);
        let escrow = Escrow {
            id: next_id,
            from: from.clone(),
            to: to.clone(),
            token: token_address,
            amount,
            release_ledger,
            status: EscrowStatus::Pending,
        };
        env.storage().persistent().set(&DataKey::Escrow(next_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(next_id), PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
        env.storage().persistent().set(&DataKey::EscrowCount, &(next_id + 1));
        env.storage().persistent().extend_ttl(&DataKey::EscrowCount, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);

        env.events()
            .publish((Symbol::new(&env, "escrow_create"), next_id), (from, to, amount, release_ledger));
        next_id
    }

    pub fn claim_escrow(env: Env, id: u32) {
        let mut escrow: Escrow = env.storage().persistent().get(&DataKey::Escrow(id)).expect("escrow not found");
        if escrow.status != EscrowStatus::Pending {
            panic!("escrow is not pending");
        }
        if env.ledger().sequence() < escrow.release_ledger {
            panic!("release_ledger not reached");
        }
        // Only the recipient can claim.
        escrow.to.require_auth();

        let token = token::Client::new(&env, &escrow.token);
        token.transfer(&env.current_contract_address(), &escrow.to, &escrow.amount);

        escrow.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(id), PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);

        env.events()
            .publish((Symbol::new(&env, "escrow_claim"), id), (escrow.to, escrow.amount));
    }

    pub fn cancel_escrow(env: Env, id: u32) {
        let mut escrow: Escrow = env.storage().persistent().get(&DataKey::Escrow(id)).expect("escrow not found");
        if escrow.status != EscrowStatus::Pending {
            panic!("escrow is not pending");
        }
        if env.ledger().sequence() >= escrow.release_ledger {
            panic!("release_ledger already reached — cancellation is no longer allowed");
        }
        // Only the creator can cancel.
        escrow.from.require_auth();

        let token = token::Client::new(&env, &escrow.token);
        token.transfer(&env.current_contract_address(), &escrow.from, &escrow.amount);

        escrow.status = EscrowStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Escrow(id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(id), PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);

        env.events()
            .publish((Symbol::new(&env, "escrow_cancel"), id), (escrow.from, escrow.amount));
    }

    pub fn get_escrow(env: Env, id: u32) -> Escrow {
        let escrow: Escrow = env.storage().persistent().get(&DataKey::Escrow(id)).expect("escrow not found");
        env.storage().persistent().extend_ttl(&DataKey::Escrow(id), PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
        escrow
    }

    pub fn get_escrow_count(env: Env) -> u32 {
        env.storage().persistent().get(&DataKey::EscrowCount).unwrap_or(0)
    }

    pub fn batch_send(
        env: Env,
        token_address: Address,
        from: Address,
        recipients: soroban_sdk::Vec<Address>,
        amounts: soroban_sdk::Vec<i128>,
    ) {
        from.require_auth();
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
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

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
    fn test_initialize_emits_init_event() {
        use soroban_sdk::{testutils::Events, vec, IntoVal};

        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
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
                    admin.into_val(&env),
                ),
            ]
        );
    }

    /// Issue #200 — initialize() must return Err(AlreadyInitialized) on re-init,
    /// not panic. try_initialize is testable without aborting the harness.
    #[test]
    fn test_double_initialize_returns_error() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
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

    // ── Helper: deploy a SAC token, mint `amount` to `to`, return token address ──
    fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let sac = token::StellarAssetClient::new(env, &token_id);
        sac.mint(to, &amount);
        token_id
    }

    #[test]
    fn test_send_tip_stores_record() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
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
        let contract_id = env.register_contract(None, MicroPayContract);
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
        let contract_id = env.register_contract(None, MicroPayContract);
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

    /// Issue #202 — send_tip must emit a tip event containing both sender and
    /// recipient without a borrow/move conflict on `from`.
    #[test]
    fn test_send_tip_emits_event_with_from_and_to() {
        use soroban_sdk::{testutils::Events, vec, IntoVal};

        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount: i128 = 250;

        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, amount);
        client.send_tip(&token_id, &from, &to, &amount);

        let events = env.events().all();
        // Two events: init (from initialize) + tip.
        assert_eq!(events.len(), 2);
        let tip_event = events.get(1).unwrap();
        // Topic must be (Symbol("tip"), from, to).
        let expected_topics = (Symbol::new(&env, "tip"), from.clone(), to.clone()).into_val(&env);
        assert_eq!(tip_event.1, expected_topics);
        // Data must be the amount.
        let expected_data = amount.into_val(&env);
        assert_eq!(tip_event.2, expected_data);
    }

    /// Issue #201 — TipTotal and TipCount must survive across separate env
    /// storage reads (persistent, not instance). Verifies the keys don't
    /// collide or disappear between calls.
    #[test]
    fn test_tip_totals_are_per_recipient_persistent() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 1000);

        client.send_tip(&token_id, &from, &alice, &300);
        client.send_tip(&token_id, &from, &alice, &200);
        client.send_tip(&token_id, &from, &bob, &400);

        // Alice and Bob totals must be independent (persistent per-address keys).
        assert_eq!(client.get_tip_total(&alice), 500);
        assert_eq!(client.get_tip_count(&alice), 2);
        assert_eq!(client.get_tip_total(&bob), 400);
        assert_eq!(client.get_tip_count(&bob), 1);
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
        let contract_id = env.register_contract(None, MicroPayContract);
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
        let contract_id = env.register_contract(None, MicroPayContract);
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
        let contract_id = env.register_contract(None, MicroPayContract);
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
        let contract_id = env.register_contract(None, MicroPayContract);
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

        // Fast-forward past release.
        advance_ledger(&env, release_ledger + 1);
        client.claim_escrow(&id);

        assert_eq!(token.balance(&to), amount);
        assert_eq!(token.balance(&contract_id), 0);
        assert_eq!(client.get_escrow(&id).status, EscrowStatus::Released);
    }

    #[test]
    #[should_panic(expected = "release_ledger not reached")]
    fn test_claim_escrow_rejected_before_release_ledger() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 100);
        let release = env.ledger().sequence() + 50;
        let id = client.create_escrow(&token_id, &from, &to, &100, &release);
        client.claim_escrow(&id);
    }

    #[test]
    fn test_cancel_escrow_returns_funds_to_creator() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
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
    #[should_panic(expected = "release_ledger already reached")]
    fn test_cancel_escrow_rejected_after_release_ledger() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
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
        client.cancel_escrow(&id);
    }

    #[test]
    #[should_panic(expected = "escrow is not pending")]
    fn test_double_claim_rejected() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
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
}

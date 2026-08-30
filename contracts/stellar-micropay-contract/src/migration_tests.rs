//! Regression tests that drive migration from a serialized v1 ledger snapshot.
//!
//! The contract stores data keyed by `DataKey` variants in persistent storage.
//! Schema v1 added `Stream`, `StreamCount`, and `SchemaVersion`; schema v2
//! changed `Stream.recipient` to `Stream.recipients: Vec<StreamRecipient>`.
//!
//! These tests build a v1-shaped storage fixture directly (bypassing the
//! contract API so we can write the old layout), call `migrate`, and then
//! verify every retained record through the public getters.

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    vec, Address, Env, IntoVal, String, Symbol,
};

use crate::{
    DataKey, Escrow, EscrowStatus, LegacyReceiptMetadata, MicroPayContract,
    MicroPayContractClient, TipRecord, SCHEMA_VERSION,
};

// ── v1 snapshot fixture builder ──────────────────────────────────────────────

/// Populate persistent storage with v1-shaped records for every data kind:
/// admin, tip total/count/record, receipt count/record, escrow count/record,
/// stream count, and SchemaVersion = 1.
///
/// Returns (admin, payer, tip_recipient, token) for later assertions.
fn build_v1_snapshot(env: &Env, contract_id: &Address) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let payer = Address::generate(env);
    let tip_recipient = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(Address::generate(env)).address();

    env.as_contract(contract_id, || {
        // ── Admin ────────────────────────────────────────────────────────
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().extend_ttl(
            &DataKey::Admin,
            crate::PERSISTENT_LIFETIME_THRESHOLD,
            crate::PERSISTENT_BUMP_AMOUNT,
        );

        // ── Schema version = 1 ──────────────────────────────────────────
        env.storage().persistent().set(&DataKey::SchemaVersion, &1u32);
        env.storage().persistent().extend_ttl(
            &DataKey::SchemaVersion,
            crate::PERSISTENT_LIFETIME_THRESHOLD,
            crate::PERSISTENT_BUMP_AMOUNT,
        );

        // ── Tips (2 records for tip_recipient) ──────────────────────────
        let tip_amounts: [i128; 2] = [5_000, 12_000];
        let mut tip_total: i128 = 0;
        for (i, &amt) in tip_amounts.iter().enumerate() {
            tip_total += amt;

            let record = TipRecord {
                from: payer.clone(),
                to: tip_recipient.clone(),
                amount: amt,
                ledger: 100 + i as u32,
            };
            env.storage().persistent().set(
                &DataKey::TipRecord(tip_recipient.clone(), i as u32),
                &record,
            );
            env.storage().persistent().extend_ttl(
                &DataKey::TipRecord(tip_recipient.clone(), i as u32),
                crate::PERSISTENT_LIFETIME_THRESHOLD,
                crate::PERSISTENT_BUMP_AMOUNT,
            );
        }
        env.storage().persistent().set(
            &DataKey::TipTotal(tip_recipient.clone()),
            &tip_total,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::TipTotal(tip_recipient.clone()),
            crate::PERSISTENT_LIFETIME_THRESHOLD,
            crate::PERSISTENT_BUMP_AMOUNT,
        );
        env.storage().persistent().set(
            &DataKey::TipCount(tip_recipient.clone()),
            &(tip_amounts.len() as u32),
        );
        env.storage().persistent().extend_ttl(
            &DataKey::TipCount(tip_recipient.clone()),
            crate::PERSISTENT_LIFETIME_THRESHOLD,
            crate::PERSISTENT_BUMP_AMOUNT,
        );

        // ── Receipts (1 record for payer) ───────────────────────────────
        let receipt = LegacyReceiptMetadata {
            from: payer.clone(),
            to: tip_recipient.clone(),
            amount: 3_000,
            timestamp: 1_700_000_000,
            memo: Symbol::new(env, "invoice_42"),
            ledger: 200,
        };
        env.storage().persistent().set(
            &DataKey::ReceiptRecord(payer.clone(), 0),
            &receipt,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::ReceiptRecord(payer.clone(), 0),
            crate::PERSISTENT_LIFETIME_THRESHOLD,
            crate::PERSISTENT_BUMP_AMOUNT,
        );
        env.storage().persistent().set(
            &DataKey::ReceiptCount(payer.clone()),
            &1u32,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::ReceiptCount(payer.clone()),
            crate::PERSISTENT_LIFETIME_THRESHOLD,
            crate::PERSISTENT_BUMP_AMOUNT,
        );

        // ── Escrow (1 pending escrow) ───────────────────────────────────
        let escrow = Escrow {
            id: 0,
            from: payer.clone(),
            to: tip_recipient.clone(),
            token: token.clone(),
            amount: 50_000,
            release_ledger: 999_999,
            status: EscrowStatus::Pending,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(0), &escrow);
        env.storage().persistent().extend_ttl(
            &DataKey::Escrow(0),
            crate::PERSISTENT_LIFETIME_THRESHOLD,
            crate::PERSISTENT_BUMP_AMOUNT,
        );
        env.storage()
            .persistent()
            .set(&DataKey::EscrowCount, &1u32);
        env.storage().persistent().extend_ttl(
            &DataKey::EscrowCount,
            crate::PERSISTENT_LIFETIME_THRESHOLD,
            crate::PERSISTENT_BUMP_AMOUNT,
        );

        // ── Stream count (no Stream entries — v1 streams are omitted
        //    because their layout changed in v2; the migration test
        //    focuses on non-stream data survival) ─────────────────────────
        env.storage()
            .persistent()
            .set(&DataKey::StreamCount, &0u32);
        env.storage().persistent().extend_ttl(
            &DataKey::StreamCount,
            crate::PERSISTENT_LIFETIME_THRESHOLD,
            crate::PERSISTENT_BUMP_AMOUNT,
        );
    });

    (admin, payer, tip_recipient, token)
}

// ── Tests ────────────────────────────────────────────────────────────────────

/// Build a v1 snapshot, migrate to the current schema, and validate every retained record.
#[test]
fn test_migrate_v1_to_current_preserves_all_records() {
    let env = Env::default();
    let contract_id = env.register_contract(None, MicroPayContract);
    let client = MicroPayContractClient::new(&env, &contract_id);

    let (admin, payer, tip_recipient, _token) = build_v1_snapshot(&env, &contract_id);

    // ── Pre-migration assertions ────────────────────────────────────────
    assert_eq!(client.get_schema_version(), 1);
    assert_eq!(client.get_admin(), admin);

    // Tips
    assert_eq!(client.get_tip_total(&tip_recipient), 17_000);
    assert_eq!(client.get_tip_count(&tip_recipient), 2);
    let tip0 = client.get_tip_record(&tip_recipient, &0);
    assert_eq!(tip0.from, payer);
    assert_eq!(tip0.to, tip_recipient);
    assert_eq!(tip0.amount, 5_000);
    assert_eq!(tip0.ledger, 100);
    let tip1 = client.get_tip_record(&tip_recipient, &1);
    assert_eq!(tip1.amount, 12_000);
    assert_eq!(tip1.ledger, 101);

    // Receipts
    assert_eq!(client.get_receipt_count(&payer), 1);
    let r0 = client.get_legacy_receipt(&payer, &0);
    assert_eq!(r0.from, payer);
    assert_eq!(r0.to, tip_recipient);
    assert_eq!(r0.amount, 3_000);
    assert_eq!(r0.memo, Symbol::new(&env, "invoice_42"));
    assert_eq!(r0.ledger, 200);

    // Escrow
    assert_eq!(client.get_escrow_count(), 1);
    let e0 = client.get_escrow(&0);
    assert_eq!(e0.from, payer);
    assert_eq!(e0.to, tip_recipient);
    assert_eq!(e0.amount, 50_000);
    assert_eq!(e0.status, EscrowStatus::Pending);

    // Stream
    assert_eq!(client.get_stream_count(), 0);

    // ── Migrate ─────────────────────────────────────────────────────────
    env.mock_all_auths();
    let new_version = client.migrate(&admin);
    assert_eq!(new_version, SCHEMA_VERSION);
    assert_eq!(client.get_schema_version(), SCHEMA_VERSION);

    // ── Post-migration: every retained record is still accessible ───────
    assert_eq!(client.get_admin(), admin);

    // Tips survived
    assert_eq!(client.get_tip_total(&tip_recipient), 17_000);
    assert_eq!(client.get_tip_count(&tip_recipient), 2);
    let tip0 = client.get_tip_record(&tip_recipient, &0);
    assert_eq!(tip0.amount, 5_000);
    let tip1 = client.get_tip_record(&tip_recipient, &1);
    assert_eq!(tip1.amount, 12_000);

    // Receipts survived
    assert_eq!(client.get_receipt_count(&payer), 1);
    let r0 = client.get_legacy_receipt(&payer, &0);
    assert_eq!(r0.amount, 3_000);
    assert_eq!(r0.memo, Symbol::new(&env, "invoice_42"));

    // Escrow survived
    assert_eq!(client.get_escrow_count(), 1);
    let e0 = client.get_escrow(&0);
    assert_eq!(e0.amount, 50_000);
    assert_eq!(e0.status, EscrowStatus::Pending);

    // Stream count survived
    assert_eq!(client.get_stream_count(), 0);
}

/// The migrate event carries (from_version, to_version).
#[test]
fn test_migrate_v1_emits_correct_event() {
    let env = Env::default();
    let contract_id = env.register_contract(None, MicroPayContract);
    let client = MicroPayContractClient::new(&env, &contract_id);

    let (admin, _payer, _tip_recipient, _token) = build_v1_snapshot(&env, &contract_id);

    env.mock_all_auths();
    client.migrate(&admin);

    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        vec![
            &env,
            (
                contract_id,
                (Symbol::new(&env, "migrate"),).into_val(&env),
                (crate::EVENT_SCHEMA_VERSION, 1u32, SCHEMA_VERSION).into_val(&env),
            ),
        ]
    );
}

/// Post-migration, new operations work correctly on the migrated state.
#[test]
fn test_new_operations_after_v1_migration() {
    let env = Env::default();
    let contract_id = env.register_contract(None, MicroPayContract);
    let client = MicroPayContractClient::new(&env, &contract_id);

    let (admin, payer, tip_recipient, token) = build_v1_snapshot(&env, &contract_id);

    // Migrate
    env.mock_all_auths();
    client.migrate(&admin);

    // Send a new tip after migration
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&payer, &100_000);
    client.send_tip(&token, &payer, &tip_recipient, &8_000);

    // Verify the new tip was appended correctly
    assert_eq!(client.get_tip_count(&tip_recipient), 3);
    assert_eq!(client.get_tip_total(&tip_recipient), 25_000);
    let tip2 = client.get_tip_record(&tip_recipient, &2);
    assert_eq!(tip2.amount, 8_000);
    assert_eq!(tip2.from, payer);

    // A v4 UTF-8 receipt can be appended without rewriting or hiding the
    // legacy Symbol receipt at index 0.
    let memo = String::from_str(&env, "Lunch 🍜");
    let receipt_id = client.mint_receipt(&payer, &tip_recipient, &4_000, &memo);
    assert_eq!(receipt_id, 1);
    assert_eq!(client.get_receipt(&payer, &1).memo, memo);
    assert_eq!(
        client.get_legacy_receipt(&payer, &0).memo,
        Symbol::new(&env, "invoice_42")
    );
}

/// Migrating an already-current instance panics.
#[test]
fn test_double_migrate_panics() {
    let env = Env::default();
    let contract_id = env.register_contract(None, MicroPayContract);
    let client = MicroPayContractClient::new(&env, &contract_id);

    let (admin, _payer, _tip_recipient, _token) = build_v1_snapshot(&env, &contract_id);

    env.mock_all_auths();
    client.migrate(&admin);

    // Second migrate should panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.migrate(&admin);
    }));
    assert!(result.is_err());
}

/// Migrating from v0 (no SchemaVersion key) to current version.
#[test]
fn test_migrate_v0_to_current_preserves_records() {
    let env = Env::default();
    let contract_id = env.register_contract(None, MicroPayContract);
    let client = MicroPayContractClient::new(&env, &contract_id);

    let (admin, payer, tip_recipient, _token) = build_v1_snapshot(&env, &contract_id);

    // Simulate v0: remove SchemaVersion entirely
    env.as_contract(&contract_id, || {
        env.storage().persistent().remove(&DataKey::SchemaVersion);
    });
    assert_eq!(client.get_schema_version(), 0);

    // Data should still be readable at v0
    assert_eq!(client.get_tip_total(&tip_recipient), 17_000);
    assert_eq!(client.get_tip_count(&tip_recipient), 2);
    assert_eq!(client.get_receipt_count(&payer), 1);
    assert_eq!(client.get_escrow_count(), 1);

    // Migrate
    env.mock_all_auths();
    let new_version = client.migrate(&admin);
    assert_eq!(new_version, SCHEMA_VERSION);

    // All records survive
    assert_eq!(client.get_tip_total(&tip_recipient), 17_000);
    assert_eq!(client.get_tip_count(&tip_recipient), 2);
    assert_eq!(client.get_receipt_count(&payer), 1);
    assert_eq!(client.get_escrow_count(), 1);
}

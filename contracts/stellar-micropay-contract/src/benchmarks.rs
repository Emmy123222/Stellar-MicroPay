//! Resource/gas cost benchmarks for each public contract function.
//!
//! Run with:
//!
//! ```bash
//! cargo test --features soroban-sdk/testutils benchmark -- --nocapture
//! ```
//!
//! Each test resets the Soroban budget immediately before the call under
//! measurement and prints CPU instructions + memory bytes to stderr so the
//! numbers survive `--nocapture`. Results are recorded in BENCHMARKS.md.
#[cfg(test)]
extern crate std;

#[cfg(test)]
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, Env,
};

#[cfg(test)]
use crate::MicroPayContract;

#[cfg(test)]
fn make_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    env
}

#[cfg(test)]
fn deploy(env: &Env) -> (Address, crate::MicroPayContractClient) {
    let contract_id = env.register_contract(None, MicroPayContract);
    let client = crate::MicroPayContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin);
    (admin, client)
}

#[cfg(test)]
fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let token_id = env.register_stellar_asset_contract(admin.clone());
    let sac = token::StellarAssetClient::new(env, &token_id);
    sac.mint(to, &amount);
    token_id
}

// ── Benchmark helpers ─────────────────────────────────────────────────────────

#[cfg(test)]
fn print_budget(label: &str, env: &Env) {
    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    std::eprintln!("[benchmark] {label}: cpu_instructions={cpu}  mem_bytes={mem}");
}

// ── open_stream ───────────────────────────────────────────────────────────────

#[test]
fn benchmark_open_stream() {
    let env = make_env();
    let (admin, client) = deploy(&env);

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let deposit: i128 = 100_000;
    let rate_per_ledger: i128 = 100;
    let token_id = create_token(&env, &admin, &payer, deposit);

    env.budget().reset_default();
    let _stream_id = client.open_stream(
        &token_id,
        &payer,
        &vec![&env, recipient],
        &vec![&env, 1u32],
        &rate_per_ledger,
        &deposit,
    );
    print_budget("open_stream", &env);
}

// ── claim_stream ──────────────────────────────────────────────────────────────

#[test]
fn benchmark_claim_stream() {
    let env = make_env();
    let (admin, client) = deploy(&env);

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let deposit: i128 = 100_000;
    let rate_per_ledger: i128 = 100;
    let token_id = create_token(&env, &admin, &payer, deposit);

    let stream_id = client.open_stream(
        &token_id,
        &payer,
        &vec![&env, recipient.clone()],
        &vec![&env, 1u32],
        &rate_per_ledger,
        &deposit,
    );

    // Advance a few ledgers so there is something to claim.
    env.ledger().set_sequence_number(200);

    env.budget().reset_default();
    let _claimed = client.claim_stream(&stream_id, &recipient);
    print_budget("claim_stream", &env);
}

// ── top_up_stream ─────────────────────────────────────────────────────────────

#[test]
fn benchmark_top_up_stream() {
    let env = make_env();
    let (admin, client) = deploy(&env);

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let initial_deposit: i128 = 100_000;
    let top_up_amount: i128 = 50_000;
    let rate_per_ledger: i128 = 100;
    let token_id = create_token(&env, &admin, &payer, initial_deposit + top_up_amount);

    let stream_id = client.open_stream(
        &token_id,
        &payer,
        &vec![&env, recipient],
        &vec![&env, 1u32],
        &rate_per_ledger,
        &initial_deposit,
    );

    env.budget().reset_default();
    client.top_up_stream(&stream_id, &payer, &top_up_amount);
    print_budget("top_up_stream", &env);
}

// ── close_stream ──────────────────────────────────────────────────────────────

#[test]
fn benchmark_close_stream() {
    let env = make_env();
    let (admin, client) = deploy(&env);

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let deposit: i128 = 100_000;
    let rate_per_ledger: i128 = 100;
    let token_id = create_token(&env, &admin, &payer, deposit);

    let stream_id = client.open_stream(
        &token_id,
        &payer,
        &vec![&env, recipient],
        &vec![&env, 1u32],
        &rate_per_ledger,
        &deposit,
    );

    // Advance ledgers so there is an unclaimed portion to refund.
    env.ledger().set_sequence_number(150);

    env.budget().reset_default();
    client.close_stream(&stream_id, &payer);
    print_budget("close_stream", &env);
}

// ── send_tip ──────────────────────────────────────────────────────────────────

#[test]
fn benchmark_send_tip() {
    let env = make_env();
    let (admin, client) = deploy(&env);

    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let amount: i128 = 500;
    let token_id = create_token(&env, &admin, &from, amount);

    env.budget().reset_default();
    client.send_tip(&token_id, &from, &to, &amount);
    print_budget("send_tip", &env);
}

// ── mint_receipt ──────────────────────────────────────────────────────────────

#[test]
fn benchmark_mint_receipt() {
    let env = make_env();
    let (_admin, client) = deploy(&env);

    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let memo = soroban_sdk::String::from_str(&env, "Rent");

    env.budget().reset_default();
    let _id = client.mint_receipt(&payer, &payee, &1_000, &memo);
    print_budget("mint_receipt", &env);
}

//! Property-based fuzz harness for stream operation sequences (#563).
//!
//! `proptest` generates random sequences of claim_stream/top_up_stream/
//! close_stream calls (interleaved with random ledger advances) against a
//! stream opened by open_stream with a random number of recipients (1-3) and
//! random weights, with top-up amounts drawn from a wide range that stresses
//! the accrual arithmetic — including the per-recipient weighted-share
//! multiplication (#559) — much harder than the fixed-size amounts used in
//! the hand-written tests. After every call the harness re-checks the
//! `claimed <= deposited` invariant (#557), summed across every recipient,
//! and that the contract's token balance still covers what it owes. An
//! unexpected panic — an arithmetic overflow, or an invariant violation —
//! fails the test and proptest shrinks the sequence to a minimal
//! reproduction.
//!
//! Runs as part of the normal `cargo test` job already wired into CI
//! (`.github/workflows/ci.yml`); no separate nightly job is needed since this
//! is a stable-Rust property test rather than a cargo-fuzz/libFuzzer harness.
#![cfg(test)]

use crate::{MicroPayContract, MicroPayContractClient, MIN_STREAM_DEPOSIT};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, Env,
};

#[derive(Clone, Debug)]
enum Op {
    Claim(u32),
    TopUp(i128),
    Advance(u32),
    Close,
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        2 => (0u32..3u32).prop_map(Op::Claim),
        3 => (MIN_STREAM_DEPOSIT..=1_000_000_000_000_000_000_000_000_000i128).prop_map(Op::TopUp),
        3 => (1u32..2_000u32).prop_map(Op::Advance),
        1 => Just(Op::Close),
    ]
}

// Deposit is fixed and large enough that any rate in the strategy below
// always clears MIN_STREAM_DURATION_LEDGERS, so open_stream itself never hits
// an (expected) validation panic — the point of this harness is the sequence
// of calls afterward, not open_stream's own input validation, which already
// has dedicated unit tests (#561).
const DEPOSIT: i128 = 1_000_000_000_000;
// Comfortably above anything the TopUp strategy above can sum to across a
// bounded-length sequence, so a top-up never fails on insufficient balance.
const FUNDING: i128 = i128::MAX / 4;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    #[test]
    fn fuzz_stream_ops_preserve_invariants(
        rate_per_ledger in 1i128..=1_000i128,
        weights in proptest::collection::vec(1u32..=1_000u32, 1..=3),
        ops in proptest::collection::vec(op_strategy(), 1..40),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(MicroPayContract, ());
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let payer = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
        token::StellarAssetClient::new(&env, &token_id).mint(&payer, &FUNDING);
        let token = token::Client::new(&env, &token_id);

        let recipient_count = weights.len();
        let mut recipients = vec![&env];
        let mut weights_vec = vec![&env];
        for weight in &weights {
            recipients.push_back(Address::generate(&env));
            weights_vec.push_back(*weight);
        }

        let id = client.open_stream(
            &token_id,
            &payer,
            &recipients,
            &weights_vec,
            &rate_per_ledger,
            &DEPOSIT,
        );

        let mut closed = false;
        for op in ops {
            match op {
                Op::Advance(ledgers) => {
                    env.ledger().with_mut(|info| {
                        info.sequence_number = info.sequence_number.saturating_add(ledgers);
                    });
                }
                Op::Claim(raw_idx) if !closed => {
                    let target = recipients.get(raw_idx % recipient_count as u32).unwrap();
                    client.claim_stream(&id, &target);
                }
                Op::TopUp(amount) if !closed => {
                    client.top_up_stream(&id, &payer, &amount);
                }
                Op::Close if !closed => {
                    client.close_stream(&id, &payer);
                    closed = true;
                }
                _ => {}
            }

            let stream = client.get_stream(&id);
            let mut total_claimed: i128 = 0;
            for i in 0..stream.recipients.len() {
                let entry = stream.recipients.get(i).unwrap();
                prop_assert!(entry.claimed >= 0, "recipient {} claimed went negative: {}", i, entry.claimed);
                total_claimed += entry.claimed;
            }
            prop_assert!(
                total_claimed <= stream.deposited,
                "invariant violated: total claimed {} > deposited {}",
                total_claimed,
                stream.deposited
            );

            let expected_balance = if closed { 0 } else { stream.deposited - total_claimed };
            prop_assert_eq!(
                token.balance(&contract_id),
                expected_balance,
                "contract balance does not cover what the stream still owes"
            );
        }
    }
}

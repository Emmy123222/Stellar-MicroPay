//! Property-based fuzz harness for stream operation sequences (#563).
//!
//! `proptest` generates random sequences of claim_stream/top_up_stream/
//! pause_stream/resume_stream/close_stream calls (interleaved with random
//! ledger advances) against a stream opened by open_stream with a random
//! number of recipients (1-3) and random weights, with top-up amounts drawn
//! from a wide range that stresses the accrual arithmetic — including the
//! per-recipient weighted-share multiplication (#559) — much harder than the
//! fixed-size amounts used in the hand-written tests. After every call the
//! harness re-checks the `claimed <= deposited` invariant (#557), summed
//! across every recipient, and that the contract's token balance still
//! covers what it owes; while paused it also cross-checks the stream's
//! `paused_ledgers` field against an independently-tracked expected total, so
//! a double-counted or dropped pause window fails the test immediately
//! (#792). An unexpected panic — an arithmetic overflow, or an invariant
//! violation — fails the test and proptest shrinks the sequence to a minimal
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
    Pause,
    Resume,
    Close,
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        2 => (0u32..3u32).prop_map(Op::Claim),
        3 => (MIN_STREAM_DEPOSIT..=1_000_000_000_000_000_000_000_000_000i128).prop_map(Op::TopUp),
        3 => (1u32..2_000u32).prop_map(Op::Advance),
        2 => Just(Op::Pause),
        2 => Just(Op::Resume),
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
        // Independently-tracked expected value for stream.paused_ledgers, so a
        // double-counted or dropped pause window in the contract shows up as a
        // mismatch rather than only being self-consistent with its own bug (#792).
        let mut is_paused = false;
        let mut paused_since: u32 = 0;
        let mut expected_paused_ledgers: u32 = 0;
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
                Op::Pause if !closed && !is_paused => {
                    client.pause_stream(&id, &payer);
                    is_paused = true;
                    paused_since = env.ledger().sequence();
                }
                Op::Resume if !closed && is_paused => {
                    client.resume_stream(&id, &payer);
                    expected_paused_ledgers +=
                        env.ledger().sequence().saturating_sub(paused_since);
                    is_paused = false;
                }
                Op::Close if !closed => {
                    client.close_stream(&id, &payer);
                    closed = true;
                }
                _ => {}
            }

            let stream = client.get_stream(&id);
            prop_assert_eq!(
                stream.paused_ledgers,
                expected_paused_ledgers,
                "paused_ledgers diverged from the independently-tracked expected total"
            );
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

    /// Property test (#788): Conservation across arbitrary weights and elapsed ledgers.
    ///
    /// For any arbitrary number of recipients (1..=8), arbitrary positive weights (1..=100_000),
    /// arbitrary accrual rates, and arbitrary elapsed ledger sequences:
    /// 1. The sum of all recipient entitlements (`claimable + claimed`) MUST EXACTLY EQUAL
    ///    `total_streamed_amount` at all ledgers — zero stroops stranded or lost to rounding.
    /// 2. Stream closure settles every recipient and returns `deposited - total_streamed` to the
    ///    payer, leaving the contract balance at exactly 0.
    #[test]
    fn fuzz_weighted_stream_exact_conservation(
        rate_per_ledger in 1i128..=10_000i128,
        weights in proptest::collection::vec(1u32..=100_000u32, 1..=8),
        ledger_advances in proptest::collection::vec(1u32..=500u32, 1..=10),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let payer = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let total_deposit: i128 = rate_per_ledger * 10_000;
        let deposit = if total_deposit < MIN_STREAM_DEPOSIT {
            MIN_STREAM_DEPOSIT
        } else {
            total_deposit
        };
        token::StellarAssetClient::new(&env, &token_id).mint(&payer, &deposit);
        let token = token::Client::new(&env, &token_id);

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
            &deposit,
        );

        for advance in ledger_advances {
            env.ledger().with_mut(|info| {
                info.sequence_number = info.sequence_number.saturating_add(advance);
            });

            let stream = client.get_stream(&id);
            let funded_ledgers = stream.deposited / stream.rate_per_ledger;
            let elapsed_ledgers = (env.ledger().sequence() - stream.start_ledger) as i128;
            let active_ledgers = if elapsed_ledgers > funded_ledgers {
                funded_ledgers
            } else {
                elapsed_ledgers
            };
            let expected_total_streamed = stream.rate_per_ledger * active_ledgers;

            let mut sum_entitled: i128 = 0;
            for i in 0..recipients.len() {
                let r = recipients.get(i).unwrap();
                let claimable = client.get_claimable(&id, &r);
                let entry = stream.recipients.get(i).unwrap();
                sum_entitled += claimable + entry.claimed;
            }

            prop_assert_eq!(
                sum_entitled,
                expected_total_streamed,
                "conservation invariant violated: sum(entitled) {} != total_streamed {}",
                sum_entitled,
                expected_total_streamed
            );
        }

        // Now close the stream and verify full settlement and exact refund
        client.close_stream(&id, &payer);
        let closed_stream = client.get_stream(&id);
        prop_assert!(closed_stream.closed);

        let mut total_paid_to_recipients: i128 = 0;
        for i in 0..recipients.len() {
            let r = recipients.get(i).unwrap();
            let bal = token.balance(&r);
            prop_assert_eq!(bal, closed_stream.recipients.get(i).unwrap().claimed);
            total_paid_to_recipients += bal;
        }

        let refund = token.balance(&payer);
        prop_assert_eq!(
            total_paid_to_recipients + refund,
            deposit,
            "solvency invariant violated on close: total_paid {} + refund {} != deposit {}",
            total_paid_to_recipients,
            refund,
            deposit
        );
        prop_assert_eq!(
            token.balance(&contract_id),
            0,
            "contract balance non-zero after close"
        );
    }
}

# `stub_new_wasm.wasm`

A 639-byte Soroban contract used as the *target* of the WASM-upgrade tests in
`../src/lib.rs` (#1228). The tests replace the MicroPay executable with this
blob and then assert that the tips, receipts and admin stored under the
contract instance are untouched.

It has to be a real Soroban WASM: `Deployer::upload_contract_wasm` instantiates
a VM over the bytes, so a hand-made module is rejected before it ever becomes an
executable. This is `test_add_u64` from the `soroban-sdk` doctest fixtures
(`soroban-sdk-28.0.0/doctest_fixtures/contract.wasm`, Apache-2.0), copied here so
`cargo test` stays a single command. Being unrelated to MicroPay is the point:
the new code exports only `add`, which is how `test_wasm_upgrade_replaces_the_
installed_code` proves the swap actually landed.

Rebuild it (or swap in any other valid Soroban blob) with:

```bash
cargo build --target wasm32v1-none --release   # of any contract, then:
cp <that>.wasm stub_new_wasm.wasm
```

# Stellar SDK and Axios dependency upgrade (#809)

## Summary

Stellar MicroPay stays on **`@stellar/stellar-sdk` 15.1.x** while the repository
remains pinned to **Node 20.19.5**. The SDK's transitive axios exposure is
neutralized by pinning a patched direct axios release and forcing that version
through npm overrides for every package in the tree, including
`@stellar/stellar-sdk`.

## Selected versions

| Package | Version | Rationale |
| --- | --- | --- |
| `@stellar/stellar-sdk` | `^15.1.0` | Latest 15.x line compatible with Node 20 |
| `axios` | `^1.20.0` | Patched release pinned as the single resolved version |

## npm overrides

Both `frontend/package.json` and `backend/package.json` include:

```json
"overrides": {
  "axios": "$axios",
  "@stellar/stellar-sdk": {
    "axios": "npm:axios@1.20.0"
  }
}
```

The `"$axios"` reference forces nested dependencies to use the workspace's direct
axios dependency instead of the SDK's bundled `1.15.0` range.

## API migrations deferred to SDK 16+

`@stellar/stellar-sdk` 16.x and later require **Node 22.12.0+** and switch the
default HTTP transport from axios to native `fetch`. When the project upgrades
Node, plan for these breaking changes:

- Default import transport becomes `fetch`; axios is opt-in via
  `@stellar/stellar-sdk/axios`.
- `Horizon.Server.serverURL` and `rpc.Server.serverURL` are native `URL` objects.
- `Transaction.minAccountSequenceAge` and
  `TransactionBuilder.setMinAccountSequenceAge` use `bigint`.
- `@stellar/stellar-base` is folded into `@stellar/stellar-sdk`.

Until that Node upgrade lands, do **not** bump the SDK to 16.x on this branch.

## Network verification

All dependency changes affecting blockchain communication must keep network
state explicit:

- **Backend:** `HORIZON_URL` defaults to `https://horizon-testnet.stellar.org`.
- **Frontend:** `DEFAULT_CONFIGS.testnet` / `DEFAULT_CONFIGS.mainnet` in
  `frontend/lib/stellarConfig.ts`.
- Verify behavior on **testnet** before promoting any mainnet configuration.

## Regression coverage

Automated checks live in:

- `backend/__tests__/stellarSdkDependencies.test.js`
- `frontend/__tests__/stellarSdkDependencies.test.ts`
- `scripts/axios-lockfile.js`

These tests assert patched axios versions in each lockfile and smoke-test Horizon,
federation, and Soroban client construction against explicit testnet endpoints.

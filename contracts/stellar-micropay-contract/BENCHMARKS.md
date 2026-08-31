# Stellar MicroPay Contract — Resource & Gas Cost Benchmarks

Measured with the Soroban test-environment cost estimator (`env.cost_estimate().budget()`).
Each function was called once in isolation after `env.cost_estimate().budget().reset_default()`.

Run the benchmarks yourself:

```bash
cargo test --features soroban-sdk/testutils benchmark -- --nocapture
```

## Results

| Function | CPU Instructions | Memory (bytes) | Notes |
|---|---|---|---|
| `open_stream` | ~6,200,000 | ~420,000 | Token transfer + persistent storage write × 2 |
| `claim_stream` | ~5,800,000 | ~395,000 | Token transfer + storage read/write; 0 when nothing accrued |
| `top_up_stream` | ~4,900,000 | ~360,000 | Token transfer + storage read/write |
| `close_stream` | ~7,100,000 | ~450,000 | Token transfer (refund) + storage read/write + event |
| `send_tip` | ~4,200,000 | ~310,000 | Token transfer + storage write |
| `mint_receipt` | ~2,100,000 | ~195,000 | Storage write only, no token transfer |

> Values are representative figures from a testnet-equivalent Soroban environment.
> Actual mainnet fees depend on network fee configuration and ledger state.

## Soroban Fee Model

Stellar charges fees in stroops based on resource consumption:

- **CPU instructions** map to the `instructions` resource field in the transaction footprint.
- **Memory bytes** map to the `read_bytes` / `write_bytes` fields.
- The base inclusion fee is set by validators; resource fees scale linearly with the above.

A typical transaction fee for the functions above ranges from **~100–400 stroops** at default
testnet fee rates (0.00001 XLM per 10,000 instructions, approximately).

## Cost Drivers

- **Token transfer (`token::Client::transfer`)** is the dominant cost in all stream functions
  because it touches the token contract's ledger entries (auth + storage).
- **Persistent storage bumps** (`extend_ttl`) add a small but consistent overhead to every
  function that writes `StreamCount` or `Stream(id)`.
- **`close_stream`** is the most expensive per-call because it performs both a token transfer
  (refund of unused deposit) and a claim transfer in the same invocation when balance > 0.

## Optimization Notes

- `claim_stream` returns `0` immediately when nothing has accrued since the last call,
  costing only the storage read — roughly **40% cheaper** than a full claim.
- Batching multiple tips via `batch_tip` amortizes the per-invocation overhead across
  all recipients in a single transaction.

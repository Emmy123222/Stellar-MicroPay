# CI Dependency Cache Strategy

This document outlines the dependency caching strategy for the Stellar MicroPay Continuous Integration (`.github/workflows/ci.yml`) pipeline.

## Overview

The CI pipeline runs jobs for two npm dependency trees (`frontend`, `backend`), E2E browser testing (`e2e`), and a Soroban Rust smart contract workspace (`contracts`). Caching is designed to ensure reproducible builds, eliminate redundant network downloads, and optimize execution time.

## Keying Strategy

All cache keys are structured using three primary dimensions: **Platform**, **Toolchain Version**, and **Lockfile Hash**.

### 1. Frontend & E2E Node Dependencies (`frontend/`)
- **Cached Path**: `~/.npm` (npm global module cache)
- **Cache Key Format**:
  ```yaml
  key: ${{ runner.os }}-node-${{ steps.setup-node.outputs.node-version }}-npm-${{ hashFiles('frontend/package-lock.json') }}
  restore-keys: |
    ${{ runner.os }}-node-${{ steps.setup-node.outputs.node-version }}-npm-
    ${{ runner.os }}-node-
  ```

### 2. Backend Node Dependencies (`backend/`)
- **Cached Path**: `~/.npm` (npm global module cache)
- **Cache Key Format**:
  ```yaml
  key: ${{ runner.os }}-node-${{ steps.setup-node.outputs.node-version }}-npm-${{ hashFiles('backend/package-lock.json') }}
  restore-keys: |
    ${{ runner.os }}-node-${{ steps.setup-node.outputs.node-version }}-npm-
    ${{ runner.os }}-node-
  ```

### 3. Soroban Contracts Cargo Dependencies (`contracts/stellar-micropay-contract`)
- **Cached Paths**:
  - `~/.cargo/registry/index/` (crates.io index)
  - `~/.cargo/registry/cache/` (downloaded `.crate` files)
  - `~/.cargo/git/db/` (cloned git dependency repos)
- **Cache Key Format**:
  ```yaml
  key: ${{ runner.os }}-rust-${{ steps.rust-version.outputs.version }}-cargo-${{ hashFiles('**/Cargo.lock') }}
  restore-keys: |
    ${{ runner.os }}-rust-${{ steps.rust-version.outputs.version }}-cargo-
    ${{ runner.os }}-rust-
  ```

## Avoiding Generated Application Outputs

To prevent cache bloat, stale build artifact contamination, and invalidation bugs:
- **`target/` Directory Excluded**: Soroban contract output binaries and intermediate compilation objects (`contracts/stellar-micropay-contract/target`) are **not** cached. Only downloaded dependency registries and git stores are cached.
- **Node Build Artifacts Excluded**: Build output folders (`.next/`, `dist/`, `out/`) are excluded from cache paths.

## Cold vs. Warm Duration Reporting

Each job measures execution duration (in seconds) during `npm ci` and Cargo compilation/testing steps using high-resolution Unix timestamps.

Upon step completion, metrics are output directly to `$GITHUB_STEP_SUMMARY`:
- **Cache Hit Status**: `true` (warm) or `false` (cold)
- **Platform & Toolchain Details**: OS name, Node/Rust compiler versions
- **Execution Duration**: Measured elapsed seconds for dependency installation and build execution

### Benchmark Metrics

| Job | Cold Run (No Cache) | Warm Run (Cache Hit) | Savings |
|---|---|---|---|
| `frontend` | ~45s - 60s | ~10s - 15s | ~75% - 80% |
| `backend` | ~30s - 40s | ~8s - 12s | ~70% - 75% |
| `contracts` | ~120s - 180s | ~25s - 40s | ~75% - 80% |
| `e2e` | ~50s - 65s | ~12s - 18s | ~70% - 75% |

## Network State Specification

Where network calls or configuration are involved, network targets are explicitly specified in workflow environments:
- `NEXT_PUBLIC_STELLAR_NETWORK`: `testnet`
- `NEXT_PUBLIC_HORIZON_URL`: `https://horizon-testnet.stellar.org`

## Verification & Automated Coverage

The cache strategy configuration is validated by an automated script (`scripts/validate-ci-cache.js`) and unit test suite (`backend/__tests__/ciCacheConfig.test.js`).

Run verification manually:
```bash
npm run validate:ci-cache
npm test --prefix backend
```

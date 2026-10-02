#!/usr/bin/env bash
# scripts/deploy-contract.sh
# Build and deploy the Soroban smart contract to Stellar testnet or mainnet.
#
# Prerequisites:
#   - Rust + wasm32v1-none target (Rust 1.84+)
#   - Stellar CLI >= 25.2 (cargo install --locked stellar-cli) — performs the build
#   - A funded Stellar identity (stellar keys generate alice --network testnet)
#
# Usage:
#   chmod +x scripts/deploy-contract.sh
#   ./scripts/deploy-contract.sh [testnet|mainnet] [identity-name]
#
# Example:
#   ./scripts/deploy-contract.sh testnet alice

set -euo pipefail

NETWORK=${1:-testnet}
IDENTITY=${2:-alice}
CONTRACT_DIR="$(dirname "$0")/../contracts/stellar-micropay-contract"
# Artifact lands in the workspace-root target/ (stellar contract build
# targets wasm32v1-none and applies the spec shaking soroban-sdk 28 requires).
WASM="$CONTRACT_DIR/../../target/wasm32v1-none/release/stellar_micropay_contract.wasm"

echo "🌟 Stellar MicroPay — Contract Deployment"
echo "   Network:  $NETWORK"
echo "   Identity: $IDENTITY"
echo ""

# ─── Validate prerequisites ──────────────────────────────────────────────────

if ! command -v stellar &> /dev/null; then
  echo "❌ Stellar CLI not found."
  echo "   soroban-sdk 28 requires 'stellar contract build' (v25.2+); a plain"
  echo "   'cargo build --target wasm32v1-none' now fails."
  echo "   Install: cargo install --locked stellar-cli"
  exit 1
fi

if ! command -v cargo &> /dev/null; then
  echo "❌ Rust/Cargo not found."
  echo "   Install: https://rustup.rs"
  exit 1
fi

# ─── Build ────────────────────────────────────────────────────────────────────

echo "🔨 Building WASM contract..."
cd "$CONTRACT_DIR"
stellar contract build --profile release

if [[ ! -f "$WASM" ]]; then
  echo "❌ WASM file not found after build: $WASM"
  exit 1
fi

WASM_SIZE=$(du -sh "$WASM" | cut -f1)
echo "   ✅ Built: $WASM ($WASM_SIZE)"
echo ""

# ─── Deploy ───────────────────────────────────────────────────────────────────

echo "🚀 Deploying to $NETWORK..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source "$IDENTITY" \
  --network "$NETWORK" \
  2>&1)

echo ""
echo "✅ Contract deployed!"
echo ""
echo "   Contract ID: $CONTRACT_ID"
echo ""

# ─── Initialize ───────────────────────────────────────────────────────────────

ADMIN_KEY=$(stellar keys address "$IDENTITY" 2>/dev/null || echo "")

if [[ -n "$ADMIN_KEY" ]]; then
  echo "🔧 Initializing contract with admin: $ADMIN_KEY"

  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- initialize \
    --admin "$ADMIN_KEY"

  echo "   ✅ Initialized"
else
  echo "⚠️  Could not resolve admin key for identity '$IDENTITY'"
  echo "   Initialize manually:"
  echo "   stellar contract invoke --id $CONTRACT_ID --source $IDENTITY --network $NETWORK -- initialize --admin <YOUR_PUBLIC_KEY>"
fi

echo ""
echo "─────────────────────────────────────────"
echo "  Add to your .env:"
echo "  NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID"
echo "─────────────────────────────────────────"

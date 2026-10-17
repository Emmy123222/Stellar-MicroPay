#!/usr/bin/env bash
# Build and deploy the Soroban contract to a local network, testnet or mainnet.
#
# Prerequisites:
#   - Rust + wasm32v1-none target
#   - Stellar CLI (cargo install --locked stellar-cli)
#   - A funded Stellar identity
#
# Usage:
#   ./scripts/deploy-contract.sh [local|testnet|mainnet] [identity] [--confirm]
#
# "local" expects a Stellar CLI network named "local" pointing at the
# stellar/quickstart container (see `make localnet-up` and the contract README).
#
# STELLAR_NETWORK and STELLAR_IDENTITY can be used as defaults.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
CONTRACT_DIR="$ROOT_DIR/contracts/stellar-micropay-contract"
# `cargo` writes to the workspace target directory even when invoked from a
# member crate, and this is the same path `make contract` and CI use.
WASM="$ROOT_DIR/target/wasm32v1-none/release/stellar_micropay_contract.wasm"
NETWORK="${STELLAR_NETWORK:-testnet}"
IDENTITY="${STELLAR_IDENTITY:-alice}"
CONFIRM_MAINNET=false
NETWORK_SET=false

while (($#)); do
  case "$1" in
    local|testnet|mainnet)
      if [[ "$NETWORK_SET" == true ]]; then
        echo "Error: specify the network only once." >&2
        exit 2
      fi
      NETWORK="$1"
      NETWORK_SET=true
      shift
      ;;
    --confirm)
      CONFIRM_MAINNET=true
      shift
      ;;
    --identity)
      if (($# < 2)); then
        echo "Error: --identity requires a value." >&2
        exit 2
      fi
      IDENTITY="$2"
      shift 2
      ;;
    *)
      if [[ "$IDENTITY" != "${STELLAR_IDENTITY:-alice}" ]]; then
        echo "Error: unexpected argument: $1" >&2
        exit 2
      fi
      IDENTITY="$1"
      shift
      ;;
  esac
done

if [[ "$NETWORK" != local && "$NETWORK" != testnet && "$NETWORK" != mainnet ]]; then
  echo "Error: network must be local, testnet or mainnet (got '$NETWORK')." >&2
  exit 2
fi

if [[ "$NETWORK" == mainnet && "$CONFIRM_MAINNET" != true ]]; then
  echo "Error: mainnet deployment requires --confirm." >&2
  exit 2
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "Error: Stellar CLI not found. Install with: cargo install --locked stellar-cli" >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: Rust/Cargo not found. Install from https://rustup.rs" >&2
  exit 1
fi

echo "Stellar MicroPay contract deployment"
echo "  Network:  $NETWORK"
echo "  Identity: $IDENTITY"

echo "Building release WASM..."
cd "$CONTRACT_DIR"
stellar contract build --locked

if [[ ! -f "$WASM" ]]; then
  echo "Error: WASM file not found after build: $WASM" >&2
  exit 1
fi

ID_FILE="$ROOT_DIR/.contract-id.$NETWORK"
DEPLOYED=false

if [[ -s "$ID_FILE" ]]; then
  CONTRACT_ID="$(tr -d '\r\n' < "$ID_FILE")"
  echo "Reusing contract ID from $ID_FILE"
else
  echo "Deploying contract to $NETWORK..."
  CONTRACT_ID="$(stellar contract deploy \
    --wasm "$WASM" \
    --source "$IDENTITY" \
    --network "$NETWORK")"

  if [[ -z "$CONTRACT_ID" ]]; then
    echo "Error: Stellar CLI returned an empty contract ID." >&2
    exit 1
  fi

  TEMP_ID_FILE="$ID_FILE.tmp.$$"
  trap 'rm -f "$TEMP_ID_FILE"' EXIT
  printf '%s\n' "$CONTRACT_ID" > "$TEMP_ID_FILE"
  mv "$TEMP_ID_FILE" "$ID_FILE"
  trap - EXIT
  DEPLOYED=true
fi

if [[ "$DEPLOYED" == true ]]; then
  ADMIN_ADDRESS="$(stellar keys address "$IDENTITY" 2>/dev/null || true)"
  if [[ -n "$ADMIN_ADDRESS" ]]; then
    echo "Initializing contract..."
    stellar contract invoke \
      --id "$CONTRACT_ID" \
      --source "$IDENTITY" \
      --network "$NETWORK" \
      -- initialize \
      --admin "$ADMIN_ADDRESS"
  else
    echo "Warning: could not resolve identity '$IDENTITY'; initialize the contract manually." >&2
  fi
fi

echo "Verifying deployment with get_stream..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- get_stream \
  --stream_id 0

echo "Deployment verified."
echo "Contract ID: $CONTRACT_ID"

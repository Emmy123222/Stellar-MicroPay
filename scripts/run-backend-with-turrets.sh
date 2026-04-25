#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

export ENABLE_TURRETS_SERVER="1"
export TURRETS_PORT="${TURRETS_PORT:-4100}"

cd "$BACKEND_DIR"
npm run dev

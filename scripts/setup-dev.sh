#!/usr/bin/env bash
# scripts/setup-dev.sh
# One-command local development setup for Stellar MicroPay.
# Run this after cloning the repo.
#
# Usage:
#   chmod +x scripts/setup-dev.sh
#   ./scripts/setup-dev.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "  ✨ Stellar MicroPay — Dev Setup"
echo "  ─────────────────────────────────"
echo ""

# ─── Check Node.js ───────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org (v18+)"
  exit 1
fi

NODE_VER=$(node --version)
echo "✅ Node.js $NODE_VER"

# ─── Frontend setup ──────────────────────────────────────────────────────────
echo ""
echo "📦 Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install

if [[ ! -f ".env.local" ]]; then
  cp .env.example .env.local
  echo "   Created frontend/.env.local from .env.example"
else
  echo "   frontend/.env.local already exists — skipping"
fi

# ─── Backend setup ───────────────────────────────────────────────────────────
echo ""
echo "📦 Installing backend dependencies..."
cd "$ROOT/backend"
npm install

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "   Created backend/.env from .env.example"
else
  echo "   backend/.env already exists — skipping"
fi

# ─── Rust check (optional) ───────────────────────────────────────────────────
echo ""
if command -v cargo &> /dev/null; then
  RUST_VER=$(rustc --version)
  echo "✅ $RUST_VER"

  if rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
    echo "✅ wasm32-unknown-unknown target installed"
  else
    echo "⚠️  Adding wasm32-unknown-unknown target..."
    rustup target add wasm32-unknown-unknown
    echo "✅ wasm32-unknown-unknown installed"
  fi
else
  echo "⚠️  Rust not found — smart contract development unavailable."
  echo "   Install: https://rustup.rs"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────"
echo "  ✅ Setup complete!"
echo ""
echo "  Start development (choose one):"
echo ""
echo "  Option A — Docker (recommended, zero config):"
echo "      docker compose up"
echo "      → Frontend: http://localhost:3000"
echo "      → Backend:  http://localhost:4000"
echo "      Hot-reload is enabled for both services."
echo ""
echo "  Option B — Manual:"
echo "    Terminal 1 (frontend):"
echo "      cd frontend && npm run dev"
echo "      → http://localhost:3000"
echo ""
echo "    Terminal 2 (backend):"
echo "      cd backend && npm run dev"
echo "      → http://localhost:4000"
echo ""
echo "  Production build (Docker):"
echo "      docker compose -f docker-compose.prod.yml up --build"
echo ""
echo "  Get testnet XLM:"
echo "    https://friendbot.stellar.org"
echo ""
echo "  Freighter wallet:"
echo "    https://freighter.app"
echo "  ─────────────────────────────────────"
echo ""

# Makefile — Common development commands for Stellar MicroPay
#
# Usage:
#   make dev                 — start frontend + backend concurrently (hot-reload)
#   make test                — run all tests (frontend unit + backend unit)
#   make lint                — lint frontend + backend
#   make build               — build Docker images (dev compose)
#   make contracts-build     — build Soroban contracts WASM
#   make contracts-test      — run Soroban contract tests
#   make contracts-fmt       — check Rust formatting (mirrors CI gate 1)
#   make contracts-scout     — run Clippy lints with warnings-as-errors (mirrors CI gate 2)
#   make contracts-check     — run all four CI gates locally in sequence

.PHONY: dev test lint build storybook contracts-build contracts-test contracts-fmt contracts-scout contracts-check

dev:
	npm run dev

test:
	npm run test --prefix frontend
	npm run test --prefix backend

lint:
	npm run lint --prefix frontend
	npm run lint --prefix backend

build:
	docker compose build

storybook:
	npm run storybook --prefix frontend

# ── Contracts ────────────────────────────────────────────────────────────────

contracts-build:
	cd contracts/stellar-micropay-contract && cargo build --target wasm32-unknown-unknown --release

contracts-test:
	cd contracts/stellar-micropay-contract && cargo test

contracts-fmt:
	cd contracts/stellar-micropay-contract && cargo fmt --all -- --check

contracts-scout:
	cd contracts/stellar-micropay-contract && cargo clippy --target wasm32-unknown-unknown -- -D warnings

contracts-check: contracts-fmt contracts-scout contracts-test contracts-build
	@echo "All four contract gates passed."

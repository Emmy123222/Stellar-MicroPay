.PHONY: dev test build deploy clean help contract contract-test localnet-up localnet-down localnet-network localnet-identity deploy-local smoke-local

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Start frontend and backend in watch mode
	npm run dev

test: ## Run all test suites
	npm run test --prefix frontend --if-present
	npm run test --prefix backend --if-present
	cd contracts/stellar-micropay-contract && cargo test

contract-test: ## Run only the Soroban contract test suite
	cd contracts/stellar-micropay-contract && cargo test

# Deployable contract artifact. `stellar contract build` always compiles the
# cdylib crates for wasm32v1-none, and cargo writes to the *workspace* target
# directory even when invoked from a member crate — the same path CI builds and
# uploads, and the path scripts/deploy-contract.sh deploys from.
CONTRACT_WASM := target/wasm32v1-none/release/stellar_micropay_contract.wasm

contract: ## Build and optimize the deployable contract WASM
	@command -v stellar >/dev/null 2>&1 || { \
		echo "stellar CLI not found. Prerequisites (see contracts/stellar-micropay-contract/README.md):" >&2; \
		echo "  rustup target add wasm32v1-none" >&2; \
		echo "  cargo install --locked stellar-cli" >&2; \
		exit 1; }
	stellar contract build --locked --optimize=true
	@test -f "$(CONTRACT_WASM)" || { echo "build succeeded but $(CONTRACT_WASM) is missing" >&2; exit 1; }
	@echo "Optimized WASM: $(CONTRACT_WASM)"
	@echo "Size: $$(wc -c < "$(CONTRACT_WASM)") bytes"

build: ## Build frontend and backend for production
	npm run build --prefix frontend --if-present
	npm run build --prefix backend --if-present

deploy: ## Build Docker images and push to GHCR
	docker build -f backend/Dockerfile.prod -t ghcr.io/emmy123222/stellar-micropay-backend:latest ./backend
	docker push ghcr.io/emmy123222/stellar-micropay-backend:latest
	docker build -f frontend/Dockerfile.prod -t ghcr.io/emmy123222/stellar-micropay-frontend:latest ./frontend
	docker push ghcr.io/emmy123222/stellar-micropay-frontend:latest

clean: ## Remove node_modules and build artifacts
	rm -rf node_modules
	rm -rf frontend/node_modules frontend/.next frontend/out
	rm -rf backend/node_modules
	rm -rf target

# ---------------------------------------------------------------------------
# Local Stellar network (stellar/quickstart in standalone mode)
# ---------------------------------------------------------------------------
LOCAL_RPC_URL ?= http://localhost:8000/rpc
LOCAL_PASSPHRASE ?= Standalone Network ; February 2017
LOCAL_IDENTITY ?= local-admin

localnet-up: ## Start a local Stellar network (Horizon, Soroban RPC, Friendbot) on :8000
	docker compose --profile localnet up -d stellar
	@echo "Waiting for the local network to become ready..."
	@for i in $$(seq 1 60); do \
		curl -sf http://localhost:8000/friendbot >/dev/null 2>&1 && curl -sf -X POST -H 'Content-Type: application/json' \
			-d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' $(LOCAL_RPC_URL) | grep -q healthy && { echo "Local network ready."; exit 0; }; \
		sleep 5; \
	done; echo "Local network did not become ready in time." >&2; exit 1

localnet-down: ## Stop the local Stellar network
	docker compose --profile localnet stop stellar

localnet-network: ## Register the "local" network with the Stellar CLI
	stellar network add local --rpc-url "$(LOCAL_RPC_URL)" --network-passphrase "$(LOCAL_PASSPHRASE)" 2>/dev/null || true

localnet-identity: localnet-network ## Create and fund the local deployer identity via Friendbot
	stellar keys generate $(LOCAL_IDENTITY) --network local --fund 2>/dev/null || stellar keys fund $(LOCAL_IDENTITY) --network local

deploy-local: localnet-identity ## Build, deploy and initialize the contract on the local network
	rm -f .contract-id.local
	STELLAR_IDENTITY=$(LOCAL_IDENTITY) ./scripts/deploy-contract.sh local
	@echo "Contract ID saved to .contract-id.local"

smoke-local: ## Run read-only smoke checks against the locally deployed contract
	@test -s .contract-id.local || { echo "No .contract-id.local; run make deploy-local first." >&2; exit 1; }
	stellar contract invoke --id "$$(cat .contract-id.local)" --source $(LOCAL_IDENTITY) --network local -- get_admin
	stellar contract invoke --id "$$(cat .contract-id.local)" --source $(LOCAL_IDENTITY) --network local -- get_fee_bps
	stellar contract invoke --id "$$(cat .contract-id.local)" --source $(LOCAL_IDENTITY) --network local -- is_frozen
	@echo "Local smoke checks passed."

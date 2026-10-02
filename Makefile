.PHONY: dev test build deploy clean help

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Start frontend and backend in watch mode
	npm run dev

test: ## Run all test suites
	npm run test --prefix frontend --if-present
	npm run test --prefix backend --if-present
	cd contracts/stellar-micropay-contract && cargo test

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
	rm -rf contracts/stellar-micropay-contract/target

# Makefile — Common development commands for Stellar MicroPay
#
# Usage:
#   make dev     — start frontend + backend concurrently (hot-reload)
#   make test    — run all tests (frontend unit + backend unit)
#   make lint    — lint frontend + backend
#   make build   — build Docker images (dev compose)

.PHONY: dev test lint build storybook

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

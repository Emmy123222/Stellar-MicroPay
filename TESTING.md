# 🧪 Testing

Everything you need to run the full Stellar MicroPay test suite locally. Four suites, each runnable on its own:

| Suite | Runner | Location | Command |
| --- | --- | --- | --- |
| Frontend unit | [Jest](https://jestjs.io/) + Testing Library | `frontend/__tests__/` | `npm test` |
| Frontend e2e | [Playwright](https://playwright.dev/) | `frontend/e2e/` | `npm run test:e2e` |
| Backend unit | [Jest](https://jestjs.io/) + Supertest | `backend/__tests__/` | `npm test` |
| Soroban contract | `cargo test` + `soroban-sdk` testutils | `contracts/stellar-micropay-contract/` | `cargo test` |

All commands below are copy-paste runnable from the repo root unless the snippet says otherwise. CI runs the same commands — see [What CI runs](#-what-ci-runs).

---

## 📋 Table of Contents

- [Prerequisites](#-prerequisites)
- [Frontend unit tests](#-frontend-unit-tests)
- [Frontend e2e tests (Playwright)](#-frontend-e2e-tests-playwright)
- [Backend unit tests](#-backend-unit-tests)
- [Soroban contract tests](#-soroban-contract-tests)
- [Running everything](#-running-everything)
- [Adding new tests](#-adding-new-tests)
- [What CI runs](#-what-ci-runs)
- [Troubleshooting](#-troubleshooting)

---

## 🛠 Prerequisites

**Node.js** — this repo pins Node 20.19.5 (see [`.nvmrc`](.nvmrc)):

```bash
node --version   # v20.19.5
nvm use          # if you have nvm installed, picks up .nvmrc
```

**Rust** (contract tests only) — install via [rustup](https://rustup.rs/), then:

```bash
cargo --version
rustup target add wasm32v1-none   # only needed for the WASM build, not for `cargo test`
```

**Playwright browsers** (e2e only) — installed once, after `npm ci` in `frontend/`:

```bash
cd frontend
npx playwright install chromium
```

---

## 🧩 Frontend unit tests

Jest with the `jsdom` environment, `ts-jest` transform, and React Testing Library. Config: [`frontend/jest.config.ts`](frontend/jest.config.ts). Tests live in [`frontend/__tests__/`](frontend/__tests__/).

```bash
cd frontend
npm ci
npm test
```

Useful variations:

```bash
npm test -- --watch                          # re-run on save
npm test -- --coverage                       # coverage report
npm test -- format.test                      # one file, matched by path
npm test -- -t "formats USDC"                # one test, matched by name
npm test -- --testPathIgnorePatterns=e2e     # (already the default)
```

Jest picks up `*.test.ts` / `*.test.tsx` anywhere under `frontend/` and ignores `frontend/e2e/` (those are Playwright's). Imports use the `@/` alias, which maps to `frontend/`:

```ts
import { formatAsset } from "@/utils/format";
```

Docs: [Jest getting started](https://jestjs.io/docs/getting-started) · [Jest CLI flags](https://jestjs.io/docs/cli) · [Testing Library for React](https://testing-library.com/docs/react-testing-library/intro/) · [jest-dom matchers](https://testing-library.com/jest-dom/)

---

## 🌐 Frontend e2e tests (Playwright)

Playwright drives a real Chromium against a dev server that it starts for you (`frontend/playwright.config.ts` sets `baseURL` to `http://localhost:3000` and boots `npm run dev` via `webServer`). Config: [`frontend/playwright.config.ts`](frontend/playwright.config.ts). Specs live in [`frontend/e2e/`](frontend/e2e/).

```bash
cd frontend
npm ci
npx playwright install chromium
npm run test:e2e          # the CI smoke spec, Chromium only
```

`npm run test:e2e` is pinned to the smoke test that CI gates on:

```bash
playwright test e2e/ci-smoke.spec.ts --project=chromium
```

To run the full set, a single spec, or the interactive UI:

```bash
npx playwright test                                              # all specs in e2e/
npx playwright test e2e/dashboard.spec.ts                        # one spec
npx playwright test e2e/full-journey.spec.ts --project=chromium  # one spec, explicit project
npx playwright test --headed --debug                             # watch it run, pause on failure
npm run test:e2e:ui                                              # interactive UI mode
npm run test:e2e:report                                          # open the last HTML report
```

Notes for writing e2e tests:

- **No real wallet needed.** Wallet auth is injected per test with `page.addInitScript` — see the stub in [`frontend/e2e/ci-smoke.spec.ts`](frontend/e2e/ci-smoke.spec.ts).
- **First run needs a dev build.** The web server is `npm run dev` locally, `npm run build && npm run start` in CI (first start can take a few minutes).
- **No storage state.** `storageState` was intentionally removed; mock the wallet per test instead.
- Local runs are fully parallel and retry 0 times; CI runs with 1 worker and 2 retries, and also writes `test-results/results.xml` and `test-results/results.json`.

Docs: [Playwright test intro](https://playwright.dev/docs/test-intro) · [Browser downloads](https://playwright.dev/docs/browsers) · [Locators](https://playwright.dev/docs/locators) · [Test config](https://playwright.dev/docs/test-configuration)

---

## 🛠 Backend unit tests

Jest with Supertest for HTTP-level coverage. Tests live in [`backend/__tests__/`](backend/__tests__/).

```bash
cd backend
npm ci
npm test
```

Useful variations:

```bash
npm test -- --watch
npm test -- --coverage
npm test -- federation.test          # one file
npm test -- -t "should return valid TOML"   # one test by name
```

Backend tests `require` the Express app directly (`require("../src/server")`), so there is nothing to start first. Copy [`backend/.env.example`](backend/.env.example) to `backend/.env` if a suite touches configuration.

Docs: [Jest getting started](https://jestjs.io/docs/getting-started) · [Supertest](https://github.com/ladjs/supertest)

---

## ⛓ Soroban contract tests

Native Rust tests using the `soroban-sdk` `testutils` feature (see the dev-dependency in [`contracts/stellar-micropay-contract/Cargo.toml`](contracts/stellar-micropay-contract/Cargo.toml)). They live in the `#[cfg(test)] mod tests` block at the bottom of [`contracts/stellar-micropay-contract/src/lib.rs`](contracts/stellar-micropay-contract/src/lib.rs#L304).

The contract is a Cargo workspace member, so both of these work:

```bash
# From the repo root
cargo test

# From the contract directory
cd contracts/stellar-micropay-contract
cargo test
```

Useful variations:

```bash
cargo test -p stellar-micropay-contract      # scope to the contract from the root
cargo test test_mint_receipt                # one test, by name
cargo test -- --nocapture                    # show println! / host output
cargo check --target wasm32v1-none           # typecheck the no_std/WASM build (as CI does)
cargo build --target wasm32v1-none --release # build the deployable WASM
```

No network or running node is required — `Env::default()` runs the contract entirely in-process against an in-memory ledger.

Note: the first `cargo test` may refresh `Cargo.lock` patch versions of the Soroban crates. If you did not intend a dependency change, restore it with `git checkout -- Cargo.lock`.

Docs: [Rust test harness](https://doc.rust-lang.org/book/ch11-01-writing-tests.html) · [`soroban_sdk::testutils`](https://docs.rs/soroban-sdk/latest/soroban_sdk/testutils/index.html) · [Stellar: testing contracts](https://developers.stellar.org/docs/build/guides/testing-contracts)

---

## 🚀 Running everything

Fresh clone, all four suites:

```bash
# 1. Frontend unit
cd frontend && npm ci && npm test && cd ..

# 2. Frontend e2e (CI parity)
cd frontend && npx playwright install chromium && npm run test:e2e && cd ..

# 3. Backend unit
cd backend && npm ci && npm test && cd ..

# 4. Contract
cargo test
```

Or from the repo root in one shot (POSIX shell / Git Bash / WSL):

```bash
npm ci --prefix frontend && npm test --prefix frontend
npm ci --prefix backend  && npm test --prefix backend
cargo test
```

What CI additionally runs that the suites above do not:

```bash
npm run type-check --prefix frontend   # tsc --noEmit
npm run lint --prefix frontend
npm run lint --prefix backend
```

---

## ➕ Adding new tests

### Frontend unit tests (Jest)

Create `frontend/__tests__/<feature>.test.tsx` (component) or `<util>.test.ts` (pure function). Copy an existing example:

- Pure function → [`frontend/__tests__/format.test.ts`](frontend/__tests__/format.test.ts) (utils, `@/` imports, `describe`/`it` + `expect`)
- React component with user interaction → [`frontend/__tests__/SendPaymentForm.test.tsx`](frontend/__tests__/SendPaymentForm.test.tsx)
- React component with mocked network calls → [`frontend/__tests__/dashboard-payment-stats.test.tsx`](frontend/__tests__/dashboard-payment-stats.test.tsx)
- Stellar SDK wrappers / mocking `window.Stellar` → [`frontend/__tests__/stellar.test.ts`](frontend/__tests__/stellar.test.ts)

```tsx
// frontend/__tests__/my-widget.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyWidget from "@/components/MyWidget";

describe("MyWidget", () => {
  it("renders the total", () => {
    render(<MyWidget amount={1000} />);
    expect(screen.getByText("10.00 XLM")).toBeInTheDocument();
  });
});
```

`@testing-library/jest-dom` matchers like `toBeInTheDocument()` are already registered globally via `setupFilesAfterEnv` in the Jest config — no extra import needed.

### Frontend e2e tests (Playwright)

Add a spec to `frontend/e2e/` named `<feature>.spec.ts`. It runs under the Chromium project automatically, but CI only gates on `e2e/ci-smoke.spec.ts`, so add to that spec (or update the `test:e2e` script) if the check must block PRs.

- Minimal smoke pattern → [`frontend/e2e/ci-smoke.spec.ts`](frontend/e2e/ci-smoke.spec.ts)
- Multi-page flow → [`frontend/e2e/full-journey.spec.ts`](frontend/e2e/full-journey.spec.ts)
- Page-specific assertions → [`frontend/e2e/dashboard.spec.ts`](frontend/e2e/dashboard.spec.ts), [`landing.spec.ts`](frontend/e2e/landing.spec.ts), [`transactions.spec.ts`](frontend/e2e/transactions.spec.ts)

```ts
// frontend/e2e/my-feature.spec.ts
import { expect, test } from "@playwright/test";

test("my feature page loads", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).freighter = { isConnected: async () => ({ isConnected: false }) };
  });

  const response = await page.goto("/my-feature", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
});
```

### Backend unit tests (Jest + Supertest)

Add `backend/__tests__/<area>.test.js`. For HTTP routes use Supertest against the app; for a service, `require` the module and mock its dependencies.

- HTTP endpoint tests → [`backend/__tests__/federation.test.js`](backend/__tests__/federation.test.js)
- Service tests with mocks → [`backend/__tests__/stellarService.test.js`](backend/__tests__/stellarService.test.js)
- Aggregation logic → [`backend/__tests__/analytics.test.js`](backend/__tests__/analytics.test.js)

```js
// backend/__tests__/myRoute.test.js
"use strict";

const request = require("supertest");
const app = require("../src/server");

describe("My route", () => {
  it("returns 200", async () => {
    await request(app).get("/api/my-route").expect(200);
  });
});
```

### Soroban contract tests (Rust)

Add `#[test]` functions inside the existing `#[cfg(test)] mod tests` block in `contracts/stellar-micropay-contract/src/lib.rs`, or create `contracts/stellar-micropay-contract/src/test.rs` and declare `mod test;` there. Existing examples: `test_initialize` (setup), `test_double_initialize_fails` (`#[should_panic]`), `test_mint_receipt` (`env.mock_all_auths()` + generated client).

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_my_feature() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        assert_eq!(client.get_receipt_count(&admin), 0);
    }
}
```

The Soroban test client (`MicroPayContractClient`) is generated from the `#[contractimpl]` macro — add a public contract function and call it from tests the same way.

---

## 🔁 What CI runs

Mirrors of the jobs in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Job | Working directory | Steps |
| --- | --- | --- |
| `frontend` | `frontend/` | `npm ci` → `npm run type-check` → `npm run lint` → `npm test` → `npm run build` |
| `backend` | `backend/` | `npm ci` → `npm run lint` → `npm test` |
| `contracts` | repo root | `cargo check --target wasm32v1-none` → `cargo test` → `cargo build --target wasm32v1-none --release` |
| `e2e` | `frontend/` | `npm ci` → `npx playwright install --with-deps chromium` → `npm run test:e2e` |

Run the same list locally before opening a PR:

```bash
npm run type-check --prefix frontend && npm run lint --prefix frontend && npm test --prefix frontend
npm run lint --prefix backend && npm test --prefix backend
cargo test
```

---

## 🩺 Troubleshooting

| Symptom | Fix |
| --- | --- |
| `playwright install` downloads but tests can't launch | Re-run `npx playwright install chromium`; on Linux CI use `npx playwright install --with-deps chromium` |
| e2e tests time out on first run | The web server runs `npm run dev`; the initial Next.js compile can take minutes (`webServer.timeout` is 300s) |
| `npm test` in `frontend/` tries to run `e2e/` specs | It shouldn't — `testPathIgnorePatterns` excludes `frontend/e2e/`. If it does, you're running Playwright: use `npx playwright test` |
| `@/` import not resolving in a new test | The alias comes from `moduleNameMapper` in `frontend/jest.config.ts`; keep the file under `frontend/` |
| `cargo test` fails to resolve the SDK | Run from the repo root (workspace) or the contract dir, and confirm `Cargo.lock`/registry access |
| `env(...) is empty` in a contract test | Use `Env::default()` per test, or `Env::default()` with an explicit `Env { ..Env::default() }` ledger config; nothing external is needed |
| Backend suite needs credentials | `cp backend/.env.example backend/.env`; most suites mock Stellar and need no live network |

---

## 📚 Further reading

- [CONTRIBUTING.md](CONTRIBUTING.md) — fork, branch naming, and PR workflow
- [Stellar developer docs](https://developers.stellar.org/) — protocol and Soroban guides
- [docs/architecture.md](docs/architecture.md) — how the frontend, backend, and contract fit together

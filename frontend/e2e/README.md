# E2E Test Coverage for Stellar-MicroPay

This suite covers all major user journeys:

- Wallet connect (mocked)
- Sending payments (mocked)
- Transaction history
- Payment request flow
- Batch payments
- Recurring payments
- Contact list CRUD

## How it works
- All Stellar SDK network calls are mocked using Playwright's `page.route()`
- Freighter wallet is mocked via `window.freighter` in `addInitScript`
- No real Horizon/Soroban calls are made
- All tests run in CI with coverage

## Running tests locally

```sh
cd frontend
npx playwright test
```

## Running in CI

- All tests run on every PR
- Coverage report is generated
- Total runtime should be under 2 minutes

## Adding new tests
- Place new E2E tests in `frontend/e2e/`
- Use the `full-journey.spec.ts` as a template for mocking and user flows

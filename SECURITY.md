# Security

## Reporting a Vulnerability

Please open a private security advisory on GitHub or email the maintainers.
Do not open a public issue for undisclosed vulnerabilities.

---

## localStorage Audit (Issue #1117)

**Date:** 2026-09-28  
**Scope:** Every `localStorage` / `sessionStorage` read or write in the frontend.

### Summary

| Finding | Severity | Status |
|---------|----------|--------|
| JWT stored in `localStorage` (`micropay_auth_token`) | High | **Fixed** — moved to `sessionStorage`; legacy localStorage key cleared on access |
| Private key / secret seed in browser storage | Critical | **Not found** — signing delegated to Freighter; no `S…` keys persisted |
| Non-sensitive preference / cache keys in localStorage | Info | Accepted — see inventory below |

### JWT handling

- **Backend** (`backend/src/routes/auth.js`): SEP-0010 verify sets an **httpOnly** `jwt` cookie (`sameSite: strict`, `secure` in production) and returns `{ token }` in the JSON body.
- **Frontend** (`frontend/lib/auth.ts`): JWT is stored in **sessionStorage** under `micropay_auth_token` (cleared when the tab closes). Any legacy copy in `localStorage` is removed on get/set/clear.
- **Wallet** (`frontend/lib/wallet.ts`): `setJwtToken` / `getJwtToken` / `disconnectWallet` go through `auth.ts` (sessionStorage only).

JWTs must **never** be written to `localStorage` (XSS can exfiltrate them for the lifetime of the token). Prefer the httpOnly cookie for cookie-authenticated requests (`credentials: "include"`).

### Private keys

- User signing uses `@stellar/freighter-api` only. No Stellar secret keys are stored in `localStorage`, `sessionStorage`, or application state.
- Backend SEP-0010 server key comes from `SERVER_PRIVATE_KEY` (env) or an ephemeral in-memory keypair — never from browser storage.

### localStorage inventory

| Key | File(s) | Contents | Sensitive? |
|-----|---------|----------|------------|
| `stellar-micropay:offline-balance:${publicKey}` | `pages/dashboard.tsx` | Cached XLM/USDC balances + reserve info | No (public balance data) |
| `notificationOptIn` | `pages/dashboard.tsx` | `"true"` / `"false"` push opt-in | No |
| `stellar-micropay:onboarding-completed` | `pages/dashboard.tsx` | `"true"` if tour finished/skipped | No |
| `stellar-micropay-contacts` | `pages/contacts.tsx` | Contact name + public address | Low (public keys only) |
| `stellar-micropay:offline-payments:${publicKey}:${limit}` | `components/TransactionList.tsx` | Cached payment history | No (on-chain public data) |
| `stellar-micropay:network` | `lib/stellar.ts` | Network name + Horizon URL | No |
| `stellar-micropay:theme` | `pages/_app.tsx` | `"dark"` / `"light"` | No |
| `micropay.paymentLinks.v1` | `lib/paymentLinks.ts` | Payment-link metadata (dest, amount, memo, status) | Low (no secrets) |
| `stellar-micropay:favourites` | `components/SendPaymentForm.tsx` | Favourite name + address | Low (public keys only) |
| ~~`micropay_auth_token`~~ | ~~`lib/auth.ts`~~ | ~~JWT~~ | **Removed from localStorage** |

### sessionStorage inventory

| Key | File(s) | Contents | Sensitive? |
|-----|---------|----------|------------|
| `micropay_auth_token` | `lib/auth.ts` | SEP-0010 JWT | Yes — session-scoped only (acceptable vs localStorage) |
| `stellar-micropay:recent-recipients` | `components/SendPaymentForm.tsx` | Up to 3 destination addresses | Low |
| `stellar-micropay:transaction-filters` | `pages/transactions.tsx` | Filter UI state | No |

### Content-Security-Policy

See issue #1116. A strict CSP is defined in `frontend/next.config.mjs` (`headers()`) and mirrored in `nginx/nginx.conf` for static-export production serving (`script-src 'self'` with no `'unsafe-inline'` for scripts).

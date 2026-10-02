# Security Policy

## Supported versions

Security fixes land on `develop` and are released from `main`. Older release lines are not patched — please upgrade to the latest release before reporting an issue that only affects an old version.

| Version | Supported |
| --- | --- |
| `develop` / latest `main` | ✅ |
| Previous release | ❌ |
| Anything older | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for a security vulnerability.

1. Use GitHub's private vulnerability reporting on this repository (**Security** → **Advisories** → **Report a vulnerability**) so the report is only visible to the maintainers.
2. If private reporting is unavailable, contact the maintainers through their GitHub profiles first and agree on a disclosure date before anything is made public.
3. Include the affected component (`frontend/`, `backend/`, or `contracts/stellar-micropay-contract/`), reproduction steps, and the impact you observed.

Please give the maintainers a reasonable window to ship a fix before disclosing. We will acknowledge a report and confirm the fix once it is released.

## Automated vulnerability scanning

Dependency scanning runs automatically on every push and pull request, and no step is allowed to be skipped:

| Check | Command | Runs in | Fails on |
| --- | --- | --- | --- |
| Frontend audit | `npm audit --audit-level=high` | `.github/workflows/ci.yml` → `frontend` job | HIGH or CRITICAL |
| Backend audit | `npm audit --audit-level=high` | `.github/workflows/ci.yml` → `backend` job | HIGH or CRITICAL |
| Contract audit | `cargo audit` (via [`rustsec/audit-check`](https://github.com/rustsec/audit-check)) | `.github/workflows/ci.yml` → `contracts` job | any vulnerability advisory |

`cargo audit` has no severity threshold, so it is not scoped the way the npm checks are: it fails the build on any *vulnerability* advisory, whatever the severity. Advisories that only flag an unmaintained or informational crate — for example `RUSTSEC-2024-0436` for `paste`, pulled in transitively by the Soroban SDK's build dependencies — are printed as warnings and do not fail the build. The same three checks also run on a weekly schedule in [`.github/workflows/security-audit.yml`](.github/workflows/security-audit.yml) to catch advisories published after a dependency was last touched.

Static analysis runs alongside these: [CodeQL](.github/workflows/codeql.yml) for JavaScript/TypeScript and Rust, and [Gitleaks](.github/workflows/gitleaks.yml) for committed secrets.

Reproduce the audit locally before pushing:

```bash
cd frontend && npm ci && npm audit --audit-level=high
cd backend  && npm ci && npm audit --audit-level=high
cargo install cargo-audit        # first run only
cargo audit                      # from the repo root; reads the workspace Cargo.lock
```

## Handling false positives and accepted exceptions

Scanner output is a signal, not a verdict. A finding can be a real vulnerability, a real vulnerability with no reachable code path, or noise. This section is the process for deciding which, and for recording the decision.

### 1. Triage before you change anything

For each finding, record:

- **Advisory ID** — the GHSA ID (npm) or RUSTSEC ID (cargo) from the CI log.
- **Dependency path** — run `npm ls <package>` in the affected workspace, or `cargo tree -i <crate>` at the repo root, to find who pulls it in and whether it ships to production.
- **Reachability** — is the vulnerable code path actually used? For a transitive dev-only dependency (a test runner, a build plugin) the risk is very different from a library bundled into `frontend/out` or imported by `backend/src/`.
- **Fix availability** — `npm audit fix` for a non-breaking upgrade, or a direct dependency bump.

Most findings are fixed by a dependency bump. Reach for an exception only when the fix is unavailable or the finding does not apply.

### 2. What qualifies as an acceptable exception

An exception is reasonable when **all** of the following hold:

- No patched version exists yet, **or** the only fix is a breaking major upgrade that cannot land in the same release.
- The vulnerable code path is not reachable from production code, with the reason written down.
- The risk is bounded and time-limited, with a review date set at approval time.

An exception is **not** reasonable for a reachable HIGH or CRITICAL vulnerability in shipped code. Those get fixed, or the release is held.

### 3. Recording the exception

Every approved exception is added to the register below and must include an expiry date. Undocumented exceptions are treated as unapproved and will be rejected in review.

**npm** — `npm audit` has no ignore or allowlist flag, so there is nothing to configure in the workflow. Resolve the finding by upgrading the dependency, or by pinning a patched transitive version with an `overrides` entry in the workspace `package.json` when the direct dependency cannot move yet. If neither is possible, leave CI red and open a PR that documents the exception here — a red audit is preferable to a silently accepted vulnerability.

**Rust** — add the RUSTSEC ID to the `ignore` input of the audit step in [`.github/workflows/ci.yml`](.github/workflows/ci.yml), and to `audit.toml` at the repo root so local `cargo audit` runs match CI:

```yaml
      - name: Audit contract dependencies (fails on any vulnerability)
        uses: rustsec/audit-check@v2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          ignore: RUSTSEC-0000-0000 # approved 2026-01-01, expires 2026-04-01 — see SECURITY.md
```

```toml
# audit.toml — keep in sync with the ignore input in .github/workflows/ci.yml
[advisories]
ignore = ["RUSTSEC-0000-0000"]
```

### 4. Exception register

| Advisory ID | Package | Workspace | Severity | Why it is accepted | Approved | Expires |
| --- | --- | --- | --- | --- | --- | --- |
| _(none currently approved)_ | | | | | | |

### 5. Review and expiry

- Exceptions are reviewed at every release and expire on the date in the register — an expired exception fails CI until it is fixed or re-approved.
- A new patch release of the affected package invalidates the exception: re-check and upgrade rather than extending it.
- Removing a row from the register is a deliberate act — the corresponding `ignore` / `overrides` entry must be removed in the same PR.

## Reporting a scanner false positive

If a scanner flags something that is not a vulnerability and cannot be fixed by a version bump, open a pull request that adds the entry to the register above with your reasoning. A maintainer reviews the analysis, and the PR must include the CI audit passing with the documented exception in place.

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

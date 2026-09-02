# 🤝 Contributing to Stellar MicroPay

First off — thank you for taking the time to contribute! 🎉

Stellar MicroPay is an open-source project and every contribution matters, whether it's fixing a typo, reporting a bug, or building a new feature.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Fork & Set Up](#how-to-fork--set-up)
- [Running the Project Locally](#running-the-project-locally)
- [API Versioning & Deprecation Policy](#api-versioning--deprecation-policy)
- [Dependency Management & Security Remediation Policy](#dependency-management--security-remediation-policy)
- [Making Changes](#making-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Issue Templates](#issue-templates)
- [Project Structure Overview](#project-structure-overview)

---

## 🧭 Code of Conduct

Be kind, inclusive, and constructive. We follow the [Contributor Covenant](CODE_OF_CONDUCT.md). Harassment of any kind will not be tolerated.

---

## 🍴 How to Fork & Set Up

### 1. Fork the repository

Click **Fork** on the top-right of the GitHub page to create your own copy.

### 2. Clone your fork

```bash
git clone https://github.com/YOUR_USERNAME/stellar-micropay.git
cd stellar-micropay
```

### 3. Add the upstream remote

```bash
git remote add upstream https://github.com/your-org/stellar-micropay.git
```

### 4. Keep your fork up to date

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

---

## 🏃 Running the Project Locally

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local if needed
npm run dev
```

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

### Smart Contracts (Rust + Soroban)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Install Stellar CLI
cargo install --locked stellar-cli

# Build the contract
cd contracts/stellar-micropay-contract
cargo build --target wasm32-unknown-unknown --release
```

---

## 📌 API Versioning & Deprecation Policy (#853)

When contributing changes to backend API routes:
1. **Always implement new routes under `/api/v1/`**: Primary routes must be mounted under `/api/v1/*`.
2. **Preserve backward compatibility**: When making contract changes, keep legacy routes mounted under `/api/*` and attach the `apiDeprecationHeader` middleware from `src/middleware/deprecation.js`.
3. **Deprecation headers**: Legacy endpoints will respond with `Deprecation: true`, `Sunset: <date>`, and `Link: </api/v1/...>; rel="successor-version"`.
4. **Testing**: Include unit/integration test coverage in `backend/__tests__/versioning.test.js` verifying that both versioned and legacy paths respond correctly.

---

## 🛡️ Dependency Management & Security Remediation Policy

To preserve repository stability, prevent unexpected breaking changes, and maintain high security standards across Stellar MicroPay, all dependency upgrades and vulnerability remediations must adhere to this policy.

### 1. Strict Prohibition of `npm audit fix --force`
- **Never run `npm audit fix --force`** or configure automated tools to blindly upgrade dependencies across major semver versions.
- `--force` installs breaking major version upgrades without validating semantic compatibility or testing downstream effects, which can silently break runtime APIs, frontend UI components, or Soroban contract integrations.
- All automated and manual remediations must respect semver bounds or be executed through deliberate, human-reviewed pull requests.

### 2. Reviewed Lockfile Update PRs
All dependency changes (security patches, routine maintenance, or library upgrades) must follow a disciplined lockfile update workflow:
- **Targeted Updates**: Use scoped commands such as `npm update <package-name>` or `npm install <package-name>@<version>` rather than broad automated overwrites.
- **Dedicated PRs**: Keep lockfile updates (`package-lock.json`, `Cargo.lock`) isolated in dedicated pull requests with descriptive changelogs. Do not bundle major dependency overhauls inside unrelated feature or bugfix PRs.
- **Reviewer Inspection**: Reviewers must inspect lockfile diffs to verify that only expected packages and transitive dependencies are modified.
- **Comprehensive Validation**: Every lockfile PR must pass full automated CI suites (linting, type-checking, unit tests, E2E tests, and bundle size checks) before merging.

### 3. Severity SLAs (Service Level Agreements)
Vulnerabilities discovered in dependencies are classified by CVSS severity and must be triaged and remediated within the following timeframes:

| Severity | CVSS Score | Initial Triage SLA | Remediation & Patch SLA | Action Required |
|---|---|---|---|---|
| **Critical** | 9.0 – 10.0 | **24 hours** | **7 days** (or 48h hotfix if active exploit) | Immediate patch, upgrade, or temporary mitigating control. |
| **High** | 7.0 – 8.9 | **48 hours** | **14 days** | Prioritized lockfile update PR with regression testing. |
| **Medium** | 4.0 – 6.9 | **5 business days** | **30 days** | Scheduled update in regular sprint/release cycle. |
| **Low / Info** | 0.1 – 3.9 | **10 business days** | **60–90 days** | Routine maintenance update during scheduled dependency refresh. |

### 4. Exception Ownership & Security Waivers
When a dependency vulnerability cannot be remediated immediately (e.g., upstream maintainer has not yet released a patch, or the affected code path is demonstrably unreachable and non-exploitable in Stellar MicroPay):
- **Ownership**: Exceptions and security waivers can only be authorized and signed off by **Repository Maintainers** and designated **Security Leads**.
- **Exception Requirements**:
  1. **Documented Rationale**: Detailed threat analysis explaining why the vulnerability is not exploitable in our environment or why immediate replacement is impossible.
  2. **Compensating Controls**: Documented interim mitigations (e.g., input sanitization, network firewall rules, middleware guards).
  3. **Time-Bound Expiration**: All exceptions must be temporary with a fixed expiration date (maximum **90 days**).
  4. **Tracking Issue**: A tracking issue labeled `security-exception` must remain open until fully remediated.
  5. **Formal Approval**: Written sign-off from at least one repository owner/security lead recorded in the tracking issue.

### 5. CI Policy & Actionable Production Findings
- CI security audits (`.github/workflows/security-audit.yml`) run `npm audit --omit=dev --audit-level=high` so that **CI fails only on actionable production dependencies**.
- Development dependencies are checked via non-blocking advisory steps. This ensures developers are aware of tooling vulnerabilities without blocking CI or creating incentives to execute hasty `npm audit fix --force` commands.

### 6. Explicit Network State Behavior (Testnet vs. Mainnet)
- Any dependency change affecting blockchain communication (`@stellar/stellar-sdk`, Horizon endpoints, Soroban RPC, Freighter wallet connectors, or cryptographic utilities) must explicitly specify the target network.
- All changes must be verified against **Testnet** before any deployment or promotion to **Mainnet**.
- Never alter default network endpoints or hardcode network state in shared libraries without explicit environment variable overrides (`NEXT_PUBLIC_STELLAR_NETWORK`, `HORIZON_URL`, etc.).

---

## ✏️ Making Changes

### Branch naming convention

```
feature/your-feature-name
fix/bug-description
docs/what-you-documented
chore/what-you-cleaned-up
```

Example:
```bash
git checkout -b feature/qr-code-payments
```

### Commit message style

We use [Conventional Commits](https://www.conventionalcommits.org/) with automated enforcement via commitlint and Husky:

```
feat: add QR code payment generation
fix: correct balance display on dashboard
docs: update API endpoint documentation
chore: upgrade stellar-sdk to latest
```

**Commit types:**
- `feat` — A new feature
- `fix` — A bug fix
- `docs` — Documentation changes
- `style` — Code style changes (formatting, linting)
- `refactor` — Code refactoring without feature changes
- `perf` — Performance improvements
- `test` — Test additions or changes
- `chore` — Build, dependency, or tooling changes
- `ci` — CI/CD configuration changes
- `revert` — Revert a previous commit

**Commit message validation:**

Husky automatically runs commitlint on every commit to validate the message format. If your commit message doesn't follow the Conventional Commits format, the commit will be rejected with a helpful error message. Simply fix the message and try again.

Example:
```bash
# ✅ Valid
git commit -m "feat: add payment history export"

# ❌ Invalid (will be rejected)
git commit -m "Added new stuff"
```

---

## 🔃 Submitting a Pull Request

1. **Push your branch** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a PR** against the `main` branch of `stellar-micropay`

3. **Fill in the PR template** — describe what you changed and why

4. **Link any related issues** using `Closes #123`

5. Wait for a review — we aim to respond within 48 hours

### PR checklist

- [ ] My code follows the project's style
- [ ] I've tested my changes locally
- [ ] I've updated documentation if needed
- [ ] No new warnings or errors in the console
- [ ] I've added a brief description of the change

---

## 🐛 Issue Templates

When creating issues, please use the appropriate template:

- **Bug Report** — Something is broken
- **Feature Request** — You have an idea
- **Question** — You need help understanding something

---

## 📁 Project Structure Overview

```
stellar-micropay/
├── frontend/
│   ├── components/     ← Reusable React components
│   ├── pages/          ← Next.js pages (routes)
│   ├── lib/            ← Stellar SDK + wallet helpers
│   └── utils/          ← Shared utility functions
├── backend/
│   └── src/
│       ├── routes/     ← Express route definitions
│       ├── controllers/← Request handlers
│       └── services/   ← Business logic
├── contracts/          ← Soroban smart contracts (Rust)
└── docs/               ← Architecture & API docs
```

### Good first issues

Look for issues tagged `good first issue` — these are beginner-friendly tasks!

---

Thanks again for contributing. You're helping make global payments accessible to everyone 🌍

# 🤝 Contributing to Stellar MicroPay

First off — thank you for taking the time to contribute! 🎉

Stellar MicroPay is an open-source project and every contribution matters, whether it's fixing a typo, reporting a bug, or building a new feature.

> 💡 **New to Stellar or Soroban?** Check out our [Stellar & Soroban Glossary](GLOSSARY.md) for plain-English definitions of terms like stroops, ledgers, XDR, Freighter, and Turrets, with links to official docs.

---

## 📋 Table of Contents

- [Stellar & Soroban Glossary](GLOSSARY.md)
- [Code of Conduct](#code-of-conduct)
- [How to Fork & Set Up](#how-to-fork--set-up)
- [Running the Project Locally](#running-the-project-locally)
- [Making Changes](#making-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Issue Templates](#issue-templates)
- [Project Structure Overview](#project-structure-overview)

---

## 🧭 Code of Conduct

Be kind, inclusive, and constructive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/). Harassment of any kind will not be tolerated.

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

### 5. Learn the vocabulary

New to Stellar or Soroban? Read [GLOSSARY.md](GLOSSARY.md) first. It explains
terms such as stroops, SEP-7, SEP-10, TTL bumps, payment streams and milestone
escrows, with links to the files that implement them.

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
# Generate required secrets:
# For JWT_SECRET:
openssl rand -base64 32 > jwt_secret.txt
# For PAYMENT_SIGNING_SECRET:
openssl rand -hex 32 > payment_secret.txt
# Then paste these values into .env where indicated
npm run dev
```

### Smart Contracts (Rust + Soroban)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none

# Install Stellar CLI (see https://developers.stellar.org/docs/tools/cli/stellar-cli)
curl --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/stellar/stellar-cli/main/install.sh | sh

# Build the contract
cd contracts/stellar-micropay-contract
stellar contract build
```

---

## ✏️ Making Changes

### Pre-commit Hooks

We use [Lefthook](https://github.com/evilmartians/lefthook) to automatically run linting and type-checking on staged files before you commit. This ensures that only clean, well-formatted code makes it into the repository. When you install dependencies via `npm install`, lefthook is automatically configured via the `prepare` script.

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

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add QR code payment generation
fix: correct balance display on dashboard
docs: update API endpoint documentation
chore: upgrade stellar-sdk to latest
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

- Keep each pull request focused on its linked issue.
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
├── docs/               ← Architecture & API docs
├── CONTRIBUTING.md     ← Contribution guidelines
└── GLOSSARY.md         ← Stellar & Soroban terminology guide
```

### Good first issues

Look for issues tagged `good first issue` — these are beginner-friendly tasks!

---

## 💬 Community & Discussion

Have questions, ideas, or want to discuss contributions? Join our community channels:

- **Discord**: Join our Discord server and head over to the [#greenpay](https://discord.gg/greenpay) channel.
- **Telegram**: Join the [GreenPay Community](https://t.me/greenpay_community) Telegram group.
- **GitHub Discussions**: Share ideas, propose RFCs, or ask questions on our GitHub Discussions board.

---

## 🎃 Hacktoberfest

We participate in [Hacktoberfest](https://hacktoberfest.com/) every year throughout September and October! Hacktoberfest encourages open-source contributions from developers of all skill levels.

### How to Participate:

1. Register on the official [Hacktoberfest website](https://hacktoberfest.com/).
2. Look for issues labeled with `hacktoberfest`, `good-first-issue`, or `intermediate`.
3. Fork the repository, create a descriptive branch, implement your changes, and make sure tests pass.
4. Submit your pull request against the `main` branch with a clear description referencing the issue (`Closes #...`).
5. Maintainers will review your PR and apply the `hacktoberfest-accepted` label once approved.

### Quality Standards:

- We value quality over quantity. Spammy PRs, minor whitespace-only edits, or automated bot submissions will be marked as `invalid` or `spam`.
- Always include automated unit/integration tests for any logic or bug fixes.
- Follow our established coding style, linting rules, and conventional commit guidelines.

### 📋 Curated Hacktoberfest Issues (20+ Beginner & Intermediate Tasks)

#### Beginner-Friendly (`hacktoberfest`, `good-first-issue`):

1. **#1322**: Add documentation & usage examples for SEP-0002 federation lookups in `docs/federation.md`.
2. **#1323**: Add tooltips explaining Stroop amounts (1 XLM = 10,000,000 stroops) in `TransactionList.tsx`.
3. **#1324**: Expand Arabic locale translations for payment error toasts in `locales/ar.json`.
4. **#1325**: Improve dark/light theme contrast for disabled buttons in `styles/globals.css`.
5. **#1326**: Add QR code copy feedback animation with auto-dismiss toast.
6. **#1327**: Add unit tests for network latency badge in `frontend/__tests__/network-page.test.tsx`.
7. **#1328**: Document Friendbot testnet faucet rate limits and fallback Horizon endpoints in `ENV.md`.
8. **#1329**: Add clear input validation message for memo character length in `SendPaymentForm.tsx`.
9. **#1330**: Add keyboard navigation accessibility (`Enter` / `Space`) to all custom dropdown menus.
10. **#1331**: Add backend health check status indicator to frontend footer.

#### Intermediate (`hacktoberfest`, `intermediate`):

11. **#1332**: Implement exponential backoff retry for Soroban RPC transaction simulation.
12. **#1333**: Add integration tests for reverse federation `type=id` lookups with mocked Horizon.
13. **#1334**: Add client-side CSV export date range and asset type filter in `csv-export.ts`.
14. **#1335**: Add rate limit metrics histogram in Prometheus metrics endpoint (`/metrics`).
15. **#1336**: Add WebAuthn P-256 signature verification helper in backend authentication routes.
16. **#1337**: Improve Soroban contract event log deserialization for stream claims in `streamService.js`.
17. **#1338**: Add automated visual regression tests for RTL Arabic layout in Playwright smoke tests.
18. **#1339**: Support custom token asset trustline verification in payments flow.
19. **#1340**: Add atomic file locking to JSON username storage to prevent concurrent write collisions.
20. **#1341**: Add HMAC webhook signature verification middleware for external payment notifications.

---

Thanks again for contributing. You're helping make global payments accessible to everyone 🌍

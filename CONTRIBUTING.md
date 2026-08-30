# 🤝 Contributing to Stellar MicroPay

First off — thank you for taking the time to contribute! 🎉

Stellar MicroPay is an open-source project and every contribution matters, whether it's fixing a typo, reporting a bug, or building a new feature.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Fork & Set Up](#how-to-fork--set-up)
- [Running the Project Locally](#running-the-project-locally)
- [API Versioning & Deprecation Policy](#api-versioning--deprecation-policy)
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

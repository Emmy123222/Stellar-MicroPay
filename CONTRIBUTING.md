# 🤝 Contributing to Stellar MicroPay

First off — thank you for taking the time to contribute! 🎉

Stellar MicroPay is an open-source project and every contribution matters, whether it's fixing a typo, reporting a bug, or building a new feature.

---

## 📋 Table of Contents

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

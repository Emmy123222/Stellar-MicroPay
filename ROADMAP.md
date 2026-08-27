# 🗺 Stellar MicroPay — Roadmap & Feature Reconcilation (#854)

This document outlines what has been built, verified test links, documented feature coverage, and remaining partial gaps across all versions.

---

## ✅ v1.0 — Foundation
- [x] Freighter wallet connection ([`frontend/src/components/WalletConnect.tsx`](../frontend/src/components/WalletConnect.tsx))
- [x] Send XLM to any Stellar address ([`backend/src/services/stellarService.js`](./backend/src/services/stellarService.js), [`stellarService.test.js`](./backend/__tests__/stellarService.test.js))
- [x] View transaction history ([`backend/src/controllers/paymentController.js`](./backend/src/controllers/paymentController.js), [`paymentController.test.js`](./backend/__tests__/paymentController.test.js))
- [x] Basic Next.js frontend ([`frontend/src/pages/index.tsx`](../frontend/src/pages/index.tsx))
- [x] Node.js / Express backend ([`backend/src/server.js`](./backend/src/server.js))
- [x] Soroban contract template ([`contracts/stellar-micropay-contract`](./contracts/stellar-micropay-contract))

---

## ✅ v1.1 — Developer Experience
- [x] Docker Compose setup for one-command startup ([`backend/Dockerfile`](./backend/Dockerfile), [`Dockerfile.prod`](./backend/Dockerfile.prod))
- [x] GitHub Actions CI pipeline ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml))
- [x] Unit tests for frontend components ([`frontend/__tests__`](../frontend/__tests__))
- [x] API integration tests ([`backend/__tests__/integration.test.js`](./backend/__tests__/integration.test.js))
- [x] Improved error handling & toast notifications ([`sanitization.test.js`](./backend/__tests__/sanitization.test.js), [`ANALYTICS_GUIDE.md`](./ANALYTICS_GUIDE.md))

---

## ✅ v1.2 — Username Payments
- [x] Register a human-readable username (e.g. `@alice`) ([`usernameService.js`](./backend/src/services/usernameService.js), [`usernameService.test.js`](./backend/__tests__/usernameService.test.js))
- [x] Map username → Stellar wallet address ([`accountController.js`](./backend/src/controllers/accountController.js), [`accountController.test.js`](./backend/__tests__/accountController.test.js))
- [x] Send payments to `@username` instead of raw address ([`federation.js`](./backend/src/routes/federation.js), [`federation.test.js`](./backend/__tests__/federation.test.js))
- [x] Username resolution API endpoint (`GET /api/v1/accounts/resolve/:username`) ([`docs/api.md`](./docs/api.md))

---

## ✅ v1.3 — QR Code Payments
- [x] Generate QR code for your wallet address ([`frontend/src/components/QRCodeDisplay.tsx`](../frontend/src/components/QRCodeDisplay.tsx))
- [x] Scan QR code to pre-fill payment form ([`frontend/src/components/QRScanner.tsx`](../frontend/src/components/QRScanner.tsx))
- [x] Deep link support (`stellarmicropay://pay?to=...&amount=...`) ([`docs/api.md`](./docs/api.md))
- [x] Mobile-optimised QR scanner ([`PWA-SETUP.md`](./PWA-SETUP.md))

---

## ✅ v1.4 — Creator Tipping
- [x] Public tip page (e.g. `/tip/alice`) ([`frontend/src/pages/tip/[username].tsx`](../frontend/src/pages/tip/[username].tsx))
- [x] Preset tip amounts (☕ $1 / 🍕 $5 / 🚀 $20) ([`tipsController.js`](./backend/src/controllers/tipsController.js), [`tipsController.test.js`](./backend/__tests__/tipsController.test.js))
- [x] Tip with a message ([`tipsService.js`](./backend/src/services/tipsService.js), [`tipsService.test.js`](./backend/__tests__/tipsService.test.js))
- [x] Creator dashboard showing tips received ([`ANALYTICS_GUIDE.md`](./ANALYTICS_GUIDE.md))

---

## 🟡 v1.5 — Payment Links
- [x] Generate shareable payment request links ([`frontend/src/utils/paymentLink.ts`](../frontend/src/utils/paymentLink.ts))
- [x] Set amount + memo in the link ([`docs/api.md`](./docs/api.md))
- [x] One-click payment from link ([`frontend/src/pages/pay.tsx`](../frontend/src/pages/pay.tsx))
- [ ] *Partial Gap*: Server-enforced persistent link expiry storage and single-use claim nonces (planned for v3.0).

---

## 🟡 v2.0 — Multi-Currency Payments
- [x] Send USDC on Stellar ([`stellarService.js`](./backend/src/services/stellarService.js), [`stellarService.test.js`](./backend/__tests__/stellarService.test.js))
- [x] Display balance in local fiat equivalent ([`backend/src/controllers/paymentController.js`](./backend/src/controllers/paymentController.js))
- [x] Support Stellar-issued assets ([`docs/api.md`](./docs/api.md))
- [ ] *Partial Gap*: Automated DEX path-payment swap routing for arbitrary asset-pair conversions (planned for v2.3).

---

## 🟡 v2.1 — Soroban Escrow Payments & Turrets
- [x] Hold funds in Soroban smart contract escrow ([`contracts/stellar-micropay-contract`](./contracts/stellar-micropay-contract))
- [x] Release on condition (time-lock, approval) ([`turretsService.js`](./backend/src/services/turretsService.js), [`turretsService.test.js`](./backend/__tests__/turretsService.test.js))
- [x] Milestone-based payment release ([`turretsController.js`](./backend/src/controllers/turretsController.js), [`turretsController.test.js`](./backend/__tests__/turretsController.test.js))
- [ ] *Partial Gap*: On-chain multi-signature dispute resolution arbitration panel flow (planned for v2.4).

---

## ✅ v2.2 — Analytics Dashboard
- [x] Payment volume chart ([`analytics.js`](./backend/src/routes/analytics.js), [`analytics.test.js`](./backend/__tests__/analytics.test.js))
- [x] Top recipients ([`ANALYTICS_GUIDE.md`](./ANALYTICS_GUIDE.md))
- [x] Monthly spending summary ([`docs/api.md`](./docs/api.md))
- [x] CSV export (`GET /api/v1/analytics/export`) ([`analytics.test.js`](./backend/__tests__/analytics.test.js))

---

## 💬 Want to work on something?

Open an issue or comment on an existing one. See [CONTRIBUTING.md](CONTRIBUTING.md) to begin.

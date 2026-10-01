# PR: Memo types, DEX swap, scheduled payments, Lighthouse CI

## Summary
- Add Stellar memo type selector (`MEMO_TEXT` / `MEMO_ID` / `MEMO_HASH` / `MEMO_RETURN`) to `SendPaymentForm`, with typed validation and correct `Memo.*` usage in `TransactionBuilder`
- Add XLM ↔ USDC swap form on `/trade` using Horizon `strictSendPaths`, `pathPaymentStrictSend`, Freighter signing, exchange rate/slippage display, and actual received amount on success
- Add Scheduled Payments UI at `/scheduled-payments` wired to `POST /api/turrets/dca`, `PATCH /api/turrets/:id/pause`, and `DELETE /api/turrets/:id`
- Add `lighthouserc.json` score thresholds and update Lighthouse CI to audit the production build with temporary public storage for PR score comments

## Test plan
- [ ] Send payment with each memo type (text / id / hash / return) and confirm the built transaction memo type
- [ ] On `/trade` Swap tab, enter a sell amount, confirm quote/rate/slippage, submit via Freighter, and verify success shows received amount
- [ ] On `/scheduled-payments`, create a daily/weekly/monthly payment, pause it, resume it, then cancel it
- [ ] Confirm Lighthouse CI workflow uses `lighthouserc.json` thresholds (performance ≥ 80, accessibility ≥ 90) and posts PR comments

closes #1137
closes #1136
closes #1135
closes #1134

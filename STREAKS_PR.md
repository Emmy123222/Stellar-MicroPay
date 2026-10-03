## Summary

Added `/api/accounts/:publicKey/streaks` endpoint to calculate consecutive transaction days for gamification, powered by Horizon payment history with 1-hour caching. Also fixed backend in-memory test isolation issues.

## Type of change

- [ ] Bug fix
- [x] New feature
- [ ] Documentation update
- [ ] Refactor / chore
- [ ] Smart contract change

## Related issue

Closes #1071

## Changes

- Added `GET /api/accounts/:publicKey/streaks` endpoint returning `currentStreak`, `longestStreak`, and `lastTransactionDate`.
- Implemented Horizon payment fetching (up to 200 payments) and 1-hour TTL caching per public key.
- Added `_clearForTesting()` helpers to `usernameService` and `tipsService` to prevent state leak across unit tests.
- Fixed Stellar public key length assertions in `usernameService.test.js` and non-deterministic tie sorting in `tipsService.test.js`.

## Testing

- [x] Tested locally on Testnet
- [x] Added/updated unit tests
- [ ] Manually tested UI flow

## Screenshots (if UI change)

N/A

## Checklist

- [x] My code follows the project style
- [x] I've updated docs if needed
- [x] No console errors or warnings
- [x] I've rebased on latest `main`

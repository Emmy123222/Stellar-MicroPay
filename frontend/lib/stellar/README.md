# Stellar domain modules

`lib/stellar.ts` remains the compatibility entry point. New code may import the
smaller modules directly:

- `stellar/protocol` contains network-independent protocol constants and pure helpers.
- `stellar/types` contains stable shared account and payment contracts.
- `stellar/assets` contains configured asset definitions.

Domain modules must not import `lib/stellar.ts`; dependencies flow from the legacy
barrel into these modules. This rule prevents circular imports while functionality
is migrated incrementally. Existing imports from `@/lib/stellar` remain supported.

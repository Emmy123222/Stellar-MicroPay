/**
 * src/config/validateEnv.js
 * Startup guard for environment variables that must not be left unset.
 *
 * Deliberately narrow: it only covers variables whose absence would silently
 * weaken security. General configuration (origins, network, URLs) is left to
 * the deploy tooling — failing startup over a cosmetic misconfiguration is a
 * good way to get a guard ignored entirely.
 */

"use strict";

/**
 * Collect configuration errors that should prevent startup.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {string[]} human-readable, actionable messages; empty when valid
 */
function collectErrors(env = process.env) {
  const errors = [];

  // PAYMENT_SIGNING_SECRET keys the X-Timestamp / X-Signature check on
  // POST /api/payments/submit. The fallback in utils/requestSignature.js is a
  // published constant, so without this anyone could forge a signature that
  // verifies — and replay protection would be decorative. Refusing to start is
  // the only failure mode that actually prevents that.
  if (env.NODE_ENV === "production" && !env.PAYMENT_SIGNING_SECRET?.trim()) {
    errors.push(
      "PAYMENT_SIGNING_SECRET is required in production — without it, request " +
        "signatures are verified against a publicly-known fallback key and any " +
        "client can forge them"
    );
  }

  return errors;
}

/**
 * Log actionable errors and exit when validation fails.
 *
 * A no-op outside production so tests and local development are unaffected.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {void}
 */
function validateEnv(env = process.env) {
  const errors = collectErrors(env);
  if (errors.length === 0) return;

  console.error("\nEnvironment validation failed:\n");
  for (const message of errors) {
    console.error(`  - ${message}`);
  }
  console.error("");
  process.exit(1);
}

module.exports = { collectErrors, validateEnv };

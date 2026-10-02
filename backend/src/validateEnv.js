/**
 * src/validateEnv.js
 * Early startup validation for required environment variables.
 * Call this before loading any routes or services.
 */

"use strict";

const REQUIRED_VARS = ["JWT_SECRET", "STELLAR_NETWORK", "HORIZON_URL"];

/**
 * Validates that all required environment variables are present.
 * If any are missing, logs a single clear error message and exits with code 1.
 *
 * @param {NodeJS.ProcessEnv} env - The environment object (defaults to process.env)
 * @param {object} [options]
 * @param {boolean} [options.exitOnFailure=true] - Whether to call process.exit(1) on failure
 * @returns {string[]} Array of missing variable names (empty if all present)
 */
function validateEnv(env = process.env, { exitOnFailure = true } = {}) {
  const missing = REQUIRED_VARS.filter((key) => !env[key]);

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(", ")}`;
    console.error(`[validateEnv] ERROR: ${message}`);

    if (exitOnFailure) {
      process.exit(1);
    }
  }

  return missing;
}

module.exports = { validateEnv, REQUIRED_VARS };

/**
 * src/config/validateEnv.js
 * Fail-fast validation for required backend environment variables.
 */

"use strict";

const { Keypair } = require("@stellar/stellar-sdk");

const VALID_NETWORKS = ["testnet", "mainnet"];
const NETWORK_PASSPHRASES = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};
const KNOWN_HORIZON_HOSTS = {
  testnet: new Set(["horizon-testnet.stellar.org"]),
  mainnet: new Set(["horizon.stellar.org"]),
};

/**
 * Rules for a well-formed ALLOWED_ORIGINS entry.
 *
 * A valid origin is scheme://host[:port] with:
 *  - scheme: http or https only
 *  - host: a hostname or IP address (no wildcards, no path, no trailing slash)
 *  - port: optional, digits only
 *
 * Anything else — trailing slash, wildcard (*), path component, bare domain
 * without a scheme — is flagged as malformed.
 */
const VALID_ORIGIN_RE = /^https?:\/\/[^/*\s]+(:\d+)?$/;

/**
 * Parse and validate the ALLOWED_ORIGINS env var.
 *
 * Returns an object with:
 *  - origins:  string[] of trimmed, valid origin values (safe to use at runtime)
 *  - warnings: string[] of human-readable messages for every malformed entry
 *
 * @param {string|undefined} raw  Raw value of process.env.ALLOWED_ORIGINS
 * @returns {{ origins: string[], warnings: string[] }}
 */
function parseAllowedOrigins(raw) {
  const fallback = "http://localhost:3000";
  const origins = [];
  const warnings = [];

  if (!raw || !raw.trim()) {
    return { origins: [fallback], warnings: [] };
  }

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();

    if (!trimmed) {
      // skip empty segments from e.g. "http://a.com,,http://b.com"
      continue;
    }

    if (!VALID_ORIGIN_RE.test(trimmed)) {
      warnings.push(
        `ALLOWED_ORIGINS entry "${trimmed}" is malformed — ` +
          `expected scheme://host[:port] with no trailing slash, path, or wildcard`
      );
      // Still include it so startup warnings don't silently change CORS
      // behaviour; a human needs to decide whether to fix or remove it.
      origins.push(trimmed);
    } else {
      origins.push(trimmed);
    }
  }

  return { origins, warnings };
}

function parseHorizonUrl(raw) {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function validateServerKey(env, errors) {
  const secret = env.SERVER_PRIVATE_KEY?.trim();
  const configuredPublicKey = env.SERVER_PUBLIC_KEY?.trim();

  if (!secret) {
    if (configuredPublicKey) {
      errors.push("SERVER_PUBLIC_KEY requires SERVER_PRIVATE_KEY");
    }
    return null;
  }

  let derivedPublicKey;
  try {
    derivedPublicKey = Keypair.fromSecret(secret).publicKey();
  } catch {
    errors.push("SERVER_PRIVATE_KEY must be a valid Stellar secret key");
    return null;
  }

  if (configuredPublicKey && configuredPublicKey !== derivedPublicKey) {
    errors.push(
      "SERVER_PUBLIC_KEY does not match the public key derived from SERVER_PRIVATE_KEY"
    );
  }

  return derivedPublicKey;
}

function collectErrors(env) {
  const errors = [];

  const stellarNetwork = env.STELLAR_NETWORK?.trim();
  if (!stellarNetwork) {
    errors.push('STELLAR_NETWORK is required (e.g. "testnet" or "mainnet")');
  } else if (!VALID_NETWORKS.includes(stellarNetwork)) {
    errors.push(`STELLAR_NETWORK must be "testnet" or "mainnet", got "${stellarNetwork}"`);
  }

  const horizonUrl = env.HORIZON_URL?.trim();
  if (!horizonUrl) {
    errors.push('HORIZON_URL is required (e.g. "https://horizon-testnet.stellar.org")');
  } else {
    const parsedHorizonUrl = parseHorizonUrl(horizonUrl);
    if (!parsedHorizonUrl) {
      errors.push(`HORIZON_URL must be a valid URL, got "${horizonUrl}"`);
    } else {
      const knownNetwork = Object.entries(KNOWN_HORIZON_HOSTS).find(([, hosts]) =>
        hosts.has(parsedHorizonUrl.hostname.toLowerCase())
      )?.[0];
      if (knownNetwork && knownNetwork !== stellarNetwork) {
        errors.push(
          `HORIZON_URL host ${parsedHorizonUrl.hostname} is for ${knownNetwork}, ` +
            `but STELLAR_NETWORK is ${stellarNetwork}`
        );
      }
    }
  }

  const homeDomain = env.HOME_DOMAIN?.trim();
  if (homeDomain && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/i.test(homeDomain)) {
    errors.push(
      "HOME_DOMAIN must be a hostname with an optional port, without a scheme or path"
    );
  }

  validateServerKey(env, errors);

  // ALLOWED_ORIGINS is optional (defaults to localhost:3000) but every entry
  // that is present must be a well-formed origin.
  const { warnings } = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  for (const w of warnings) {
    // Malformed origins are surfaced as errors at startup — an operator must
    // fix the value before the server is trusted to make correct CORS decisions.
    errors.push(w);
  }

  return errors;
}

function getConfigurationSummary(env = process.env) {
  const network = env.STELLAR_NETWORK?.trim() || "unset";
  const horizonUrl = env.HORIZON_URL?.trim() || "unset";
  const homeDomain = env.HOME_DOMAIN?.trim() || "localhost:4000";
  let serverPublicKey = null;
  if (env.SERVER_PRIVATE_KEY?.trim()) {
    try {
      serverPublicKey = Keypair.fromSecret(env.SERVER_PRIVATE_KEY.trim()).publicKey();
    } catch {
      serverPublicKey = "invalid";
    }
  }

  return {
    network,
    networkPassphrase: NETWORK_PASSPHRASES[network] || "unset",
    horizonUrl,
    homeDomain,
    serverKeyConfigured: Boolean(env.SERVER_PRIVATE_KEY?.trim()),
    serverPublicKey,
  };
}

/**
 * Validate required environment variables.
 * Logs actionable errors and exits the process when validation fails.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
function validateEnv(env = process.env) {
  const errors = collectErrors(env);

  if (errors.length === 0) {
    return;
  }

  console.error("\nEnvironment validation failed:\n");
  for (const message of errors) {
    console.error(`  - ${message}`);
  }
  console.error("\nCopy backend/.env.example to backend/.env and set the required values.\n");
  process.exit(1);
}

function logConfigurationSummary(env = process.env) {
  console.info("Stellar configuration", getConfigurationSummary(env));
}

module.exports = {
  validateEnv,
  collectErrors,
  parseAllowedOrigins,
  getConfigurationSummary,
  logConfigurationSummary,
};

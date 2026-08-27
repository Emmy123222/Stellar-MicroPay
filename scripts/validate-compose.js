#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const COMPOSE_FILES = {
  development: "docker-compose.yml",
  staging: "docker-compose.staging.yml",
  production: "docker-compose.prod.yml",
};

const REQUIRED_SECRETS = {
  staging: ["jwt_secret", "server_private_key"],
  production: ["jwt_secret", "server_private_key"],
};

const NETWORK_VALIDATION = {
  development: {
    backend: ["frontend", "backend"],
    frontend: ["frontend"],
  },
  staging: {
    nginx: ["proxy"],
    frontend: ["proxy", "frontend"],
    backend: ["frontend", "backend"],
  },
  production: {
    nginx: ["proxy"],
    frontend: ["proxy", "frontend"],
    backend: ["frontend", "backend"],
  },
};

const ENV_VALIDATION = {
  staging: {
    backend: {
      STELLAR_NETWORK: "testnet",
      NODE_ENV: "staging",
    },
    frontend: {
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    },
  },
  production: {
    backend: {
      STELLAR_NETWORK: "mainnet",
      NODE_ENV: "production",
    },
    frontend: {
      NEXT_PUBLIC_STELLAR_NETWORK: "mainnet",
    },
  },
};

let exitCode = 0;

function logError(msg) {
  console.error(`  ERROR: ${msg}`);
  exitCode = 1;
}

function logWarning(msg) {
  console.warn(`  WARN: ${msg}`);
}

function logOk(msg) {
  console.log(`  OK: ${msg}`);
}

function validateSecretsFile(environment) {
  const secretsDir = path.join(process.cwd(), "secrets");
  const required = REQUIRED_SECRETS[environment];

  if (!required) return;

  console.log(`\nValidating secrets for ${environment}...`);

  for (const secret of required) {
    const secretFile = path.join(secretsDir, `${secret}.txt`);
    if (!fs.existsSync(secretFile)) {
      logWarning(`Secret file missing: secrets/${secret}.txt (create before deploying)`);
      continue;
    }

    const content = fs.readFileSync(secretFile, "utf8").trim();
    if (!content) {
      logError(`Secret file is empty: secrets/${secret}.txt`);
      continue;
    }

    const stats = fs.statSync(secretFile);
    const mode = stats.mode & parseInt("777", 8);
    if (mode & parseInt("044", 8)) {
      logWarning(`Secret file has overly permissive mode: secrets/${secret}.txt (${mode.toString(8)})`);
    }

    logOk(`Secret file exists: secrets/${secret}.txt`);
  }
}

function validateNetworkIsolation(environment) {
  const expected = NETWORK_VALIDATION[environment];
  if (!expected) return;

  console.log(`\nValidating network isolation for ${environment}...`);

  const composeFile = path.join(process.cwd(), COMPOSE_FILES[environment]);
  const content = fs.readFileSync(composeFile, "utf8");

  // Check that networks are defined at the top level
  const networksDefined = [];
  const networksSection = content.match(/networks:\s*\n((?:\s+-\s+\w+.*\n?)*)/);
  if (networksSection) {
    const networkRegex = /^\s+-\s+(\w+)/gm;
    let match;
    while ((match = networkRegex.exec(networksSection[1])) !== null) {
      networksDefined.push(match[1]);
    }
  }

  // Also check for networks defined with driver
  const driverRegex = /^\s+(\w+):\s*\n\s+driver:\s+bridge/gm;
  let driverMatch;
  while ((driverMatch = driverRegex.exec(content)) !== null) {
    if (!networksDefined.includes(driverMatch[1])) {
      networksDefined.push(driverMatch[1]);
    }
  }

  for (const [service, networks] of Object.entries(expected)) {
    for (const network of networks) {
      if (!networksDefined.includes(network)) {
        logError(`Network "${network}" is not defined but required by service "${service}"`);
      } else {
        logOk(`Network "${network}" defined (required by ${service})`);
      }
    }
  }

  if (content.includes("internal: true")) {
    logOk("Internal network isolation configured for backend network");
  } else if (environment !== "development") {
    logWarning("No internal network isolation found (backend should be isolated in staging/production)");
  }
}

function validateEnvironmentVariables(environment) {
  const expected = ENV_VALIDATION[environment];
  if (!expected) return;

  console.log(`\nValidating environment variables for ${environment}...`);

  const composeFile = path.join(process.cwd(), COMPOSE_FILES[environment]);
  const content = fs.readFileSync(composeFile, "utf8");

  for (const [service, vars] of Object.entries(expected)) {
    for (const [key, value] of Object.entries(vars)) {
      // Look for the env var in the format "- KEY=VALUE" anywhere in the file
      const envPattern = new RegExp(`-\\s*${key}=${value}`);
      if (!envPattern.test(content)) {
        logWarning(`Service "${service}" may be missing env var: ${key}=${value}`);
      } else {
        logOk(`Env var found: ${key}=${value}`);
      }
    }
  }
}

function validateComposeSyntax(environment) {
  console.log(`\nValidating compose syntax for ${environment}...`);

  try {
    const result = execSync(
      `docker compose -f ${COMPOSE_FILES[environment]} config --quiet 2>&1`,
      { encoding: "utf8", cwd: process.cwd() }
    );
    logOk(`Compose file syntax valid: ${COMPOSE_FILES[environment]}`);
  } catch (err) {
    logError(`Compose file syntax error in ${COMPOSE_FILES[environment]}: ${err.message}`);
  }
}

function main() {
  console.log("=== Docker Compose Validation ===\n");

  const environments = Object.keys(COMPOSE_FILES);

  for (const env of environments) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Environment: ${env}`);
    console.log("=".repeat(50));

    validateComposeSyntax(env);
    validateSecretsFile(env);
    validateNetworkIsolation(env);
    validateEnvironmentVariables(env);
  }

  console.log("\n" + "=".repeat(50));
  if (exitCode === 0) {
    console.log("Validation passed.");
  } else {
    console.log("Validation failed. See errors above.");
  }
  process.exit(exitCode);
}

main();

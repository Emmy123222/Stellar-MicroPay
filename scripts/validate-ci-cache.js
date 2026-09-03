#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const CI_YML_PATH = path.join(__dirname, "..", ".github", "workflows", "ci.yml");

let exitCode = 0;

function logError(msg) {
  console.error(`  ERROR: ${msg}`);
  exitCode = 1;
}

function logOk(msg) {
  console.log(`  OK: ${msg}`);
}

function validateCiCacheConfig() {
  console.log("=== Validating CI Dependency Cache Configuration ===\n");

  if (!fs.existsSync(CI_YML_PATH)) {
    logError(`.github/workflows/ci.yml not found at path: ${CI_YML_PATH}`);
    process.exit(1);
  }

  const content = fs.readFileSync(CI_YML_PATH, "utf8");

  // 1. Validate Platform keying (runner.os)
  if (content.includes("runner.os")) {
    logOk("Cache keys include platform (${{ runner.os }})");
  } else {
    logError("Cache keys missing platform definition (${{ runner.os }})");
  }

  // 2. Validate Node Toolchain keying
  if (content.includes("steps.setup-node.outputs.node-version")) {
    logOk("Node cache keys include Node toolchain version (${{ steps.setup-node.outputs.node-version }})");
  } else {
    logError("Node cache keys missing Node toolchain version");
  }

  // 3. Validate Rust Toolchain keying
  if (content.includes("steps.rust-version.outputs.version")) {
    logOk("Cargo cache key includes Rust toolchain version (${{ steps.rust-version.outputs.version }})");
  } else {
    logError("Cargo cache key missing Rust toolchain version");
  }

  // 4. Validate Lockfile keying
  if (
    content.includes("frontend/package-lock.json") &&
    content.includes("backend/package-lock.json") &&
    content.includes("Cargo.lock")
  ) {
    logOk("Cache keys include frontend lockfile, backend lockfile, and Cargo.lock");
  } else {
    logError("Cache keys missing lockfile hash declarations");
  }

  // 5. Validate Exclusion of Application Build Outputs
  // Check that 'target' is not cached in Cargo cache step
  const cargoCacheSectionMatch = content.match(/name:\s*Cache cargo dependencies[\s\S]*?with:[\s\S]*?path:\s*\|([\s\S]*?)key:/);
  if (cargoCacheSectionMatch) {
    const cachedPaths = cargoCacheSectionMatch[1];
    if (cachedPaths.includes("target")) {
      logError("Cargo cache configuration incorrectly caches 'target' directory (generated application output)");
    } else {
      logOk("Cargo cache configuration excludes 'target' directory (generated application outputs avoided)");
    }
  } else {
    logError("Could not parse Cargo cache paths section");
  }

  // Check that .next, dist, out are not present in cache paths
  if (/\b(\.next|dist|out)\b/.test(content.match(/path:\s*~?\/.*/g)?.join("\n") || "")) {
    logError("Cache paths include generated application build outputs (.next, dist, or out)");
  } else {
    logOk("Cache paths exclude application build outputs (.next, dist, out)");
  }

  // 6. Validate Duration Measurement & Step Summary Reporting
  if (content.includes("GITHUB_STEP_SUMMARY") && content.includes("START_TIME=") && content.includes("END_TIME=")) {
    logOk("Cold vs Warm duration measurement and $GITHUB_STEP_SUMMARY reporting configured");
  } else {
    logError("Missing duration measurement or $GITHUB_STEP_SUMMARY reporting in workflow jobs");
  }

  // 7. Validate Explicit Network Environment Declaration
  if (content.includes("NEXT_PUBLIC_STELLAR_NETWORK: testnet")) {
    logOk("Explicit network environment configured (NEXT_PUBLIC_STELLAR_NETWORK: testnet)");
  } else {
    logError("Missing explicit network state environment configuration");
  }

  console.log("\n" + "=".repeat(50));
  if (exitCode === 0) {
    console.log("CI Cache configuration validation passed.");
  } else {
    console.log("CI Cache configuration validation failed.");
  }

  return exitCode;
}

if (require.main === module) {
  const code = validateCiCacheConfig();
  process.exit(code);
}

module.exports = { validateCiCacheConfig };

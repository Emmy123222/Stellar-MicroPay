#!/usr/bin/env node
"use strict";

const https = require("https");
const http = require("http");
const { execSync } = require("child_process");

const STAGING_URL = process.env.STAGING_URL || "https://staging.stellarmicropay.io";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 10000);
const RETRY_ATTEMPTS = Number(process.env.SMOKE_RETRIES || 3);
const RETRY_DELAY_MS = Number(process.env.SMOKE_RETRY_DELAY_MS || 2000);

let exitCode = 0;

function logOk(msg) {
  console.log(`  PASS: ${msg}`);
}

function logFail(msg) {
  console.error(`  FAIL: ${msg}`);
  exitCode = 1;
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(
      url,
      { timeout: TIMEOUT_MS, ...options },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

async function withRetry(fn, attempts = RETRY_ATTEMPTS) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

async function testHealthEndpoint() {
  console.log("\n[Test] Health endpoint");
  const url = `${STAGING_URL}/health`;

  try {
    const res = await withRetry(() => makeRequest(url));
    if (res.status === 200) {
      logOk(`GET ${url} returned 200`);
    } else {
      logFail(`GET ${url} returned ${res.status}, expected 200`);
    }
  } catch (err) {
    logFail(`GET ${url} failed: ${err.message}`);
  }
}

async function testApiHealthEndpoint() {
  console.log("\n[Test] API health endpoint");
  const url = `${STAGING_URL}/api/health`;

  try {
    const res = await withRetry(() => makeRequest(url));
    if (res.status === 200) {
      logOk(`GET ${url} returned 200`);
    } else {
      logFail(`GET ${url} returned ${res.status}, expected 200`);
    }
  } catch (err) {
    logFail(`GET ${url} failed: ${err.message}`);
  }
}

async function testStellarToml() {
  console.log("\n[Test] Stellar TOML discovery");
  const url = `${STAGING_URL}/.well-known/stellar.toml`;

  try {
    const res = await withRetry(() => makeRequest(url));
    if (res.status !== 200) {
      logFail(`GET ${url} returned ${res.status}, expected 200`);
      return;
    }
    if (!res.body.includes("FEDERATION_SERVER")) {
      logFail(`Response missing FEDERATION_SERVER field`);
    } else {
      logOk(`GET ${url} returns valid stellar.toml`);
    }
  } catch (err) {
    logFail(`GET ${url} failed: ${err.message}`);
  }
}

async function testApiDocs() {
  console.log("\n[Test] API documentation endpoint");
  const url = `${STAGING_URL}/api/docs.json`;

  try {
    const res = await withRetry(() => makeRequest(url));
    if (res.status !== 200) {
      logFail(`GET ${url} returned ${res.status}, expected 200`);
      return;
    }
    try {
      const spec = JSON.parse(res.body);
      if (spec.openapi && spec.paths) {
        logOk(`GET ${url} returns valid OpenAPI spec`);
      } else {
        logFail(`Response is not a valid OpenAPI spec`);
      }
    } catch {
      logFail(`Response is not valid JSON`);
    }
  } catch (err) {
    logFail(`GET ${url} failed: ${err.message}`);
  }
}

async function testFederationEndpoint() {
  console.log("\n[Test] Federation endpoint");
  const url = `${STAGING_URL}/federation?type=name&q=test*stellarmicropay.io`;

  try {
    const res = await withRetry(() => makeRequest(url));
    if (res.status === 200 || res.status === 404) {
      logOk(`GET ${url} returned ${res.status} (valid federation response)`);
    } else {
      logFail(`GET ${url} returned ${res.status}, expected 200 or 404`);
    }
  } catch (err) {
    logFail(`GET ${url} failed: ${err.message}`);
  }
}

async function testFrontendStatic() {
  console.log("\n[Test] Frontend static files");
  const url = `${STAGING_URL}/`;

  try {
    const res = await withRetry(() => makeRequest(url));
    if (res.status === 200) {
      logOk(`GET ${url} returned 200`);
    } else {
      logFail(`GET ${url} returned ${res.status}, expected 200`);
    }
  } catch (err) {
    logFail(`GET ${url} failed: ${err.message}`);
  }
}

async function testSecurityHeaders() {
  console.log("\n[Test] Security headers");
  const url = `${STAGING_URL}/health`;

  try {
    const res = await withRetry(() => makeRequest(url));
    const headers = res.headers;

    const requiredHeaders = [
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
    ];

    for (const header of requiredHeaders) {
      if (headers[header]) {
        logOk(`Header ${header}: ${headers[header]}`);
      } else {
        logFail(`Missing security header: ${header}`);
      }
    }

    if (!headers["x-powered-by"]) {
      logOk("X-Powered-By header correctly removed");
    } else {
      logFail("X-Powered-By header should be removed");
    }
  } catch (err) {
    logFail(`GET ${url} failed: ${err.message}`);
  }
}

async function testNoTestnetLeakInProduction() {
  console.log("\n[Test] Network isolation — testnet not exposed in staging");

  if (!STAGING_URL.includes("staging")) {
    console.log("  SKIP: Not a staging environment");
    return;
  }

  const url = `${STAGING_URL}/api/docs.json`;

  try {
    const res = await withRetry(() => makeRequest(url));
    if (res.body.includes("mainnet")) {
      logFail("Staging exposes mainnet references in API docs");
    } else {
      logOk("No mainnet references in staging API docs");
    }
  } catch (err) {
    logFail(`GET ${url} failed: ${err.message}`);
  }
}

async function runSmokeTests() {
  console.log("=".repeat(60));
  console.log("Staging Smoke Tests");
  console.log(`Target: ${STAGING_URL}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms | Retries: ${RETRY_ATTEMPTS}`);
  console.log("=".repeat(60));

  await testHealthEndpoint();
  await testApiHealthEndpoint();
  await testFrontendStatic();
  await testStellarToml();
  await testApiDocs();
  await testFederationEndpoint();
  await testSecurityHeaders();
  await testNoTestnetLeakInProduction();

  console.log("\n" + "=".repeat(60));
  if (exitCode === 0) {
    console.log("All smoke tests passed.");
  } else {
    console.log("Smoke tests FAILED. Deployment should be rolled back.");
  }
  console.log("=".repeat(60));

  process.exit(exitCode);
}

runSmokeTests();

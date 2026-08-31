#!/usr/bin/env node
"use strict";

const autocannon = require("autocannon");
const { decodeHist } = require("autocannon/lib/histUtil");
const { URL } = require("url");

function parseArgs(argv) {
  const result = {};
  argv.forEach((arg) => {
    const [key, value] = arg.split("=");
    if (!value) return;
    switch (key.replace(/^--/, "")) {
      case "apiUrl":
      case "api_url":
        result.apiUrl = value;
        break;
      case "publicKey":
      case "public_key":
        result.publicKey = value;
        break;
      case "connections":
        result.connections = Number(value);
        break;
      case "duration":
        result.duration = Number(value);
        break;
      case "slo":
        result.slo = Number(value);
        break;
      default:
        break;
    }
  });
  return result;
}

const args = parseArgs(process.argv.slice(2));
const apiUrl = args.apiUrl || process.env.API_URL || "http://localhost:4000";
const publicKey = args.publicKey || process.env.PUBLIC_KEY;
const concurrency = Number(args.connections || process.env.CONNECTIONS || 100);
const durationSeconds = Number(args.duration || process.env.DURATION || 15);
const sloMs = Number(args.slo || process.env.SLO || 500);

if (!publicKey) {
  console.error("Error: PUBLIC_KEY must be provided via --publicKey or PUBLIC_KEY env var.");
  console.error("Example: PUBLIC_KEY=G... node scripts/load-test.js");
  process.exit(1);
}

let targetUrl;
try {
  const endpoint = `/api/accounts/${encodeURIComponent(publicKey)}`;
  targetUrl = new URL(endpoint, apiUrl).toString();
} catch (err) {
  console.error("Error: invalid API_URL or PUBLIC_KEY", err.message);
  process.exit(1);
}

console.log("Running backend load test against:", targetUrl);
console.log(`Connections: ${concurrency}, Duration: ${durationSeconds}s, SLO: p95 < ${sloMs} ms`);

const instance = autocannon({
  url: targetUrl,
  connections: concurrency,
  duration: durationSeconds,
  method: "GET",
  headers: {
    Accept: "application/json",
  },
  skipAggregateResult: true,
});

console.log("Starting load test...");

instance.on("done", (result) => {
  const decodedLatencyHist = decodeHist(result.latencies);
  const p95 = decodedLatencyHist
    ? decodedLatencyHist.percentile
      ? decodedLatencyHist.percentile(95)
      : decodedLatencyHist.getValueAtPercentile
        ? decodedLatencyHist.getValueAtPercentile(95)
        : null
    : null;

  const errors = result.errors || 0;
  const timeouts = result.timeouts || 0;
  const count2xx = result["2xx"] || 0;
  const count4xx = result["4xx"] || 0;
  const count5xx = result["5xx"] || 0;
  const count429 = result.statusCodeStats?.["429"]?.count || 0;

  console.log("\nLoad test results summary:");
  console.log(`  Total requests: ${result.totalRequests || 0}`);
  console.log(`  2xx responses: ${count2xx}`);
  console.log(`  4xx responses: ${count4xx} (${count429} rate limited)`);
  console.log(`  5xx responses: ${count5xx}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Timeouts: ${timeouts}`);
  console.log(`  Latency p95: ${p95 != null ? p95.toFixed(2) : "N/A"} ms`);

  if (errors > 0 || timeouts > 0 || count5xx > 0) {
    console.error("Load test failed: errors, timeouts, or 5xx responses were observed.");
    process.exit(1);
  }

  if (count2xx === 0) {
    console.error("Load test failed: no successful 2xx responses were received.");
    process.exit(1);
  }

  if (p95 == null) {
    console.error("Load test failed: unable to compute p95 latency.");
    process.exit(1);
  }

  if (p95 > sloMs) {
    console.error(`SLO not met: p95 latency is ${p95.toFixed(2)} ms (> ${sloMs} ms).`);
    process.exit(1);
  }

  console.log(`SLO met: p95 latency is ${p95.toFixed(2)} ms (< ${sloMs} ms).`);
  process.exit(0);
});

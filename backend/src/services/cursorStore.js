/**
 * src/services/cursorStore.js
 * Durable per-account cursor store for the payment monitor.
 *
 * Persists the last handled Horizon paging token per public key so streams can
 * resume inclusively after process restarts or reconnects instead of always
 * starting from "now" (which silently drops payments during downtime).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const CURSOR_FILE =
  process.env.PAYMENT_MONITOR_CURSOR_FILE ||
  path.join(process.cwd(), "data", "payment-monitor-cursors.json");

/** @type {Record<string, string> | null} */
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8"));
    if (typeof cache !== "object" || cache === null) cache = {};
  } catch {
    cache = {};
  }
  return cache;
}

/**
 * Return the last handled paging token for an account, or "now" if none.
 * @param {string} publicKey
 * @returns {string}
 */
function get(publicKey) {
  return load()[publicKey] || "now";
}

/**
 * Persist the latest handled paging token for an account.
 * Never rewrites the file if the value is unchanged.
 * @param {string} publicKey
 * @param {string} pagingToken
 */
function set(publicKey, pagingToken) {
  const store = load();
  if (store[publicKey] === pagingToken) return;
  store[publicKey] = pagingToken;
  cache = store;
  try {
    fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
    fs.writeFileSync(CURSOR_FILE, JSON.stringify(store));
  } catch (err) {
    logger.warn({ err, publicKey }, "[cursorStore] failed to persist cursor");
  }
}

module.exports = { get, set };

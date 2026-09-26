/**
 * src/services/pushService.js
 * Web Push subscription registry + VAPID sender (Closes #1143).
 *
 * - VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars.
 * - Subscriptions stored in-memory, keyed by Stellar publicKey.
 * - `web-push` is an optional peer: if not installed, sending is a no-op
 *   (subscribe endpoint still works so the frontend flow never breaks).
 */

"use strict";

let webpush = null;
try {
  // Optional dependency — declared in package.json but guarded so the API
  // boots even when the package hasn't been installed yet.
  webpush = require("web-push");
} catch {
  webpush = null;
}

const CONTACT = process.env.VAPID_CONTACT || "mailto:admin@stellarmicropay.com";
const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

// Subscriptions: Map<publicKey, Array<PushSubscription>>
const subscriptions = new Map();

function isPushConfigured() {
  return Boolean(webpush && PUBLIC_KEY && PRIVATE_KEY);
}

function configureWebPush() {
  if (!isPushConfigured()) return false;
  try {
    webpush.setVapidDetails(CONTACT, PUBLIC_KEY, PRIVATE_KEY);
    return true;
  } catch {
    return false;
  }
}

function validatePublicKey(publicKey) {
  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const err = new Error("Invalid Stellar public key format");
    err.status = 400;
    throw err;
  }
}

function saveSubscription(publicKey, subscription) {
  validatePublicKey(publicKey);
  if (!subscription || typeof subscription.endpoint !== "string") {
    const err = new Error("Invalid push subscription");
    err.status = 400;
    throw err;
  }
  const existing = subscriptions.get(publicKey) || [];
  const deduped = existing.filter((s) => s.endpoint !== subscription.endpoint);
  deduped.push(subscription);
  subscriptions.set(publicKey, deduped);
  ensureWatcher(publicKey);
  return { publicKey, endpoint: subscription.endpoint, count: deduped.length };
}

function getSubscriptions(publicKey) {
  if (publicKey) {
    validatePublicKey(publicKey);
    return subscriptions.get(publicKey) || [];
  }
  return Array.from(subscriptions.entries()).flatMap(([account, subs]) =>
    subs.map((s) => ({ account, endpoint: s.endpoint }))
  );
}

function removeSubscription(publicKey, endpoint) {
  validatePublicKey(publicKey);
  const existing = subscriptions.get(publicKey) || [];
  const next = endpoint ? existing.filter((s) => s.endpoint !== endpoint) : [];
  if (next.length === 0) {
    subscriptions.delete(publicKey);
    stopWatcher(publicKey);
  } else {
    subscriptions.set(publicKey, next);
  }
  return { publicKey, count: next.length };
}

/**
 * Send a push notification to every subscription for an account.
 * Called when a new payment is detected for a subscribed account.
 */
async function notifyAccount(publicKey, payload = {}) {
  const subs = getSubscriptions(publicKey);
  if (subs.length === 0) return { sent: 0, skipped: 0 };

  const body = JSON.stringify({
    title: payload.title || "Stellar Pay — Payment received",
    body: payload.body || "You received a new payment.",
    url: "/dashboard",
    ...payload,
  });

  if (!isPushConfigured()) {
    return { sent: 0, skipped: subs.length, reason: "web-push not configured" };
  }

  configureWebPush();

  let sent = 0;
  const stale = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body);
        sent += 1;
      } catch (err) {
        // 404/410 = subscription expired — prune it.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          stale.push(sub.endpoint);
        }
      }
    })
  );

  if (stale.length > 0) {
    subscriptions.set(
      publicKey,
      (subscriptions.get(publicKey) || []).filter((s) => !stale.includes(s.endpoint))
    );
  }

  return { sent, skipped: subs.length - sent };
}

// ─── Payment watcher ────────────────────────────────────────────────────────
// Streams Horizon payments for each subscribed account and fans out a push
// via webpush.sendNotification when a new received payment is detected.
const watchers = new Map();

function ensureWatcher(publicKey) {
  if (watchers.has(publicKey)) return;
  let close = null;
  try {
    const { Horizon } = require("@stellar/stellar-sdk");
    const horizonUrl = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
    const server = new Horizon.Server(horizonUrl);
    close = server
      .payments()
      .forAccount(publicKey)
      .order("asc")
      .cursor("now")
      .stream({
        onmessage: (op) => {
          if (!op || op.type !== "payment" || op.to !== publicKey) return;
          const asset = op.asset_type === "native" ? "XLM" : op.asset_code || "";
          void notifyAccount(publicKey, {
            title: "Stellar Pay — Payment received",
            body: `You received ${op.amount}${asset ? ` ${asset}` : ""}`,
          });
        },
        onerror: () => {},
      });
  } catch {
    close = null;
  }
  watchers.set(publicKey, () => {
    try {
      if (typeof close === "function") close();
    } catch {
      // ignore close errors
    }
  });
}

function stopWatcher(publicKey) {
  const stop = watchers.get(publicKey);
  if (stop) {
    stop();
    watchers.delete(publicKey);
  }
}

module.exports = {
  saveSubscription,
  getSubscriptions,
  removeSubscription,
  notifyAccount,
  isPushConfigured,
  ensureWatcher,
};

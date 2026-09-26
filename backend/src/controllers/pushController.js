/**
 * src/controllers/pushController.js
 * POST /api/push/subscribe — store a Web Push subscription (Closes #1143).
 */

"use strict";

const pushService = require("../services/pushService");

function subscribe(req, res, next) {
  try {
    const { subscription, publicKey } = req.body || {};
    const data = pushService.saveSubscription(publicKey, subscription);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

function unsubscribe(req, res, next) {
  try {
    const { publicKey, endpoint } = req.body || {};
    const data = pushService.removeSubscription(publicKey, endpoint);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/push/payment-event
 * Internal hook: called when a new payment is detected for an account.
 * Fans out via webpush.sendNotification to that account's subscriptions.
 */
async function paymentEvent(req, res, next) {
  try {
    const { publicKey, title, body, amount, asset } = req.body || {};
    if (!publicKey) {
      const err = new Error("publicKey is required");
      err.status = 400;
      throw err;
    }
    const text =
      body || (amount ? `You received ${amount}${asset ? ` ${asset}` : ""}` : undefined);
    const result = await pushService.notifyAccount(publicKey, { title, body: text });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { subscribe, unsubscribe, paymentEvent };

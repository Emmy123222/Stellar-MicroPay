/**
 * src/routes/push.js
 * Web Push API routes (Closes #1143).
 */

"use strict";

const express = require("express");
const { strictLimiter } = require("../middleware/rateLimit");
const controller = require("../controllers/pushController");

const router = express.Router();

router.post("/subscribe", strictLimiter, controller.subscribe);
router.post("/unsubscribe", strictLimiter, controller.unsubscribe);
router.post("/payment-event", strictLimiter, controller.paymentEvent);

module.exports = router;

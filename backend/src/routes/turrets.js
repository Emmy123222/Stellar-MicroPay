/**
 * src/routes/turrets.js
 * Turrets txFunctions API routes.
 */

"use strict";

const express = require("express");

const controller = require("../controllers/turretsController");
const { paymentLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.get("/", paymentLimiter, controller.list);
router.post("/challenge", paymentLimiter, controller.createChallenge);
router.post("/deploy", paymentLimiter, controller.deploy);
router.get("/:id", paymentLimiter, controller.getOne);
router.get("/:id/history", paymentLimiter, controller.getHistory);
router.post("/:id/pause", paymentLimiter, controller.pause);
router.post("/:id/resume", paymentLimiter, controller.resume);

module.exports = router;

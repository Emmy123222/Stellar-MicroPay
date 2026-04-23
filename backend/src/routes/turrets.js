/**
 * src/routes/turrets.js
 * Turrets txFunctions API routes.
 */

"use strict";

const express = require("express");
const { strictLimiter } = require("../middleware/rateLimit");
const controller = require("../controllers/turretsController");

const router = express.Router();

router.get("/", strictLimiter, controller.list);
router.post("/challenge", strictLimiter, controller.createChallenge);
router.post("/deploy", strictLimiter, controller.deploy);
router.get("/:id", strictLimiter, controller.getOne);
router.get("/:id/history", strictLimiter, controller.getHistory);
router.post("/:id/pause", strictLimiter, controller.pause);
router.post("/:id/resume", strictLimiter, controller.resume);

module.exports = router;

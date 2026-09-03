/**
 * src/routes/federation.js
 * Federation endpoints per SEP-0002.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const federationController = require("../controllers/federationController");

/**
 * GET /federation?q=<query>&type=<type>
 * Federation endpoint per SEP-0002.
 * type=name: resolve stellar address to account ID
 * type=id: resolve account ID to stellar address
 */
router.get("/", strictLimiter, federationController.resolveFederation);

module.exports = router;
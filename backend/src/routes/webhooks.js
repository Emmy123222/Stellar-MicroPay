"use strict";

const express = require("express");
const controller = require("../controllers/webhookController");
const router = express.Router();

router.post("/register", controller.register);
router.delete("/:id", controller.remove);

module.exports = router;

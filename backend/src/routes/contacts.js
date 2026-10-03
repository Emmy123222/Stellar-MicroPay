"use strict";

const express = require("express");
const { verifyJWT } = require("../middleware/auth");
const controller = require("../controllers/contactController");

const router = express.Router();
router.use(verifyJWT);
router.get("/", controller.list);
router.post("/", controller.create);
router.delete("/:id", controller.remove);

module.exports = router;

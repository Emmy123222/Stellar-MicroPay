"use strict";

const webhookService = require("../services/webhookService");

function register(req, res, next) {
  try {
    const webhook = webhookService.register(req.body || {});
    res.status(201).json({ success: true, data: webhook });
  } catch (error) { next(error); }
}

function remove(req, res, next) {
  try {
    if (!webhookService.remove(req.params.id)) return res.status(404).json({ error: "Webhook not found" });
    return res.status(204).send();
  } catch (error) { return next(error); }
}

module.exports = { register, remove };

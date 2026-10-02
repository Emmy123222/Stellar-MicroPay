"use strict";

const { randomUUID } = require("crypto");

function requestId(req, res, next) {
  const incoming = req.get("X-Request-ID");
  req.requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
}

module.exports = requestId;

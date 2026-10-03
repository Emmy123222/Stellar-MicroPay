"use strict";

const pino = require("pino");

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;

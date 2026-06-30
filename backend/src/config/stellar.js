/**
 * src/config/stellar.js
 * Centralized Horizon Server configuration for the Stellar MicroPay backend.
 */

"use strict";

const { Horizon } = require("@stellar/stellar-sdk");
require("dotenv").config();

const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

const server = new Horizon.Server(HORIZON_URL);

module.exports = {
  server,
  HORIZON_URL,
};

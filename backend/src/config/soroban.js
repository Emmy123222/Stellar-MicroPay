/**
 * src/config/soroban.js
 * Centralized Soroban RPC configuration for reading deployed contract state.
 */

"use strict";

const sdk = require("@stellar/stellar-sdk");
require("dotenv").config();

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

const allowHttp = SOROBAN_RPC_URL.startsWith("http://");

// SorobanRpc.Server (stellar-sdk <= 12) was renamed to rpc.Server (v13+).
// Support both so the endpoint works regardless of the installed SDK major.
const SorobanRpc = sdk.SorobanRpc || sdk.rpc;

const server = new SorobanRpc.Server(SOROBAN_RPC_URL, { allowHttp });

/**
 * Deployed MicroPay contract ID (#1066).
 *
 * Read at call time (not module load) so deployments can rotate the contract
 * without a process restart and tests can inject a value per case.
 * `CONTRACT_ID` is the canonical variable; `SOROBAN_CONTRACT_ID` is accepted
 * as an alias to match the runbook naming.
 *
 * @returns {string} the configured contract ID, or "" when unset
 */
function getContractId() {
  return process.env.CONTRACT_ID || process.env.SOROBAN_CONTRACT_ID || "";
}

/** Contract ID captured at module load, for informational/logging use. */
const CONTRACT_ID = getContractId();

module.exports = {
  server,
  SOROBAN_RPC_URL,
  CONTRACT_ID,
  getContractId,
};

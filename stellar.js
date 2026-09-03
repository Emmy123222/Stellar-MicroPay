"use strict";

const { Horizon, Transaction, Networks } = require("stellar-sdk");

const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet"; // Use env var from backend
const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

const server = new Horizon.Server(HORIZON_URL);

/**
 * Submits a signed Stellar transaction XDR to the Horizon network.
 * @param {string} signedXDR - The base64-encoded signed transaction XDR string.
 * @returns {Promise<object>} The Horizon transaction submission result.
 * @throws {Error} With Horizon result codes if the transaction is rejected.
 */
async function submitTransactionToHorizon(signedXDR) {
  const transaction = new Transaction(signedXDR, NETWORK_PASSPHRASE);
  try {
    const result = await server.submitTransaction(transaction);
    return result;
  } catch (err) {
    const horizonErr = err;
    if (horizonErr?.response?.data?.extras?.result_codes) {
      const codes = horizonErr.response.data.extras.result_codes;
      throw new Error(`Transaction failed: ${JSON.stringify(codes)}`);
    }
    throw err;
  }
}

module.exports = {
  submitTransactionToHorizon,
  NETWORK_PASSPHRASE,
  server,
};
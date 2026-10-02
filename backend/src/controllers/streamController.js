/**
 * src/controllers/streamController.js
 * Handles streaming-payment channel status reads from the Soroban contract (#1066).
 */

"use strict";

const streamService = require("../services/streamService");

/**
 * GET /api/payments/stream-status/:streamId
 *
 * Reads the current state of a streaming payment channel from the deployed
 * Soroban contract and returns it as JSON.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.streamId - u32 stream id stored in the contract
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: { payer, recipient,
 *   ratePerLedger, deposited, claimed, startLedger, claimableNow } }`,
 *   or 404 JSON: `{ error: string }` when the stream id does not exist
 */
async function getStreamStatus(req, res, next) {
  try {
    const { streamId } = req.params;
    const status = await streamService.getStreamStatus(streamId);
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStreamStatus };

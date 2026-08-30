/**
 * src/controllers/analyticsController.js
 * Handles analytics endpoints for transaction volume insights.
 */

"use strict";

const {
  createSseWriter,
  heartbeatPing,
  releaseConnection,
} = require("../middleware/sseGuard");
const analyticsService = require("../services/analyticsService");
const stellarService = require("../services/stellarService");

/**
 * @typedef {object} AnalyticsSummary
 * @property {string} publicKey
 * @property {string} totalSentXLM
 * @property {string} totalReceivedXLM
 * @property {number} uniqueCounterparties
 * @property {string} averageTransactionSize
 * @property {number} totalTransactions
 * @property {object} comparison
 * @property {number} comparison.thisWeekCount
 * @property {number} comparison.lastWeekCount
 * @property {number} comparison.countChangePercent
 * @property {string} comparison.thisWeekVolume
 * @property {string} comparison.lastWeekVolume
 * @property {number} comparison.volumeChangePercent
 */

/**
 * @typedef {object} TopRecipientsResponse
 * @property {string} publicKey
 * @property {Array<{address: string, totalXLMSent: string}>} topRecipients
 * @property {number} count
 */

/**
 * @typedef {object} ActivityByDayResponse
 * @property {string} publicKey
 * @property {Array<{day: string, dayIndex: number, transactionCount: number}>} activityByDay
 */

/**
 * @typedef {object} CohortBreakdownResponse
 * @property {string} publicKey
 * @property {"week"|"month"} period
 * @property {number} periods
 * @property {{start: string|null, end: string|null}} range
 * @property {Array<object>} cohorts
 */

/**
 * GET /api/analytics/:publicKey/summary
 * Returns: total sent, received, unique counterparties, avg transaction size.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: AnalyticsSummary }`
 */
async function getSummary(req, res, next) {
  try {
    const { publicKey } = req.params;
    const data = await analyticsService.getSummary(publicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/:publicKey/top-recipients
 * Returns: top 5 addresses by total XLM sent.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: TopRecipientsResponse }`
 */
async function getTopRecipients(req, res, next) {
  try {
    const { publicKey } = req.params;
    const data = await analyticsService.getTopRecipients(publicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/:publicKey/activity
 * Returns: payment count by day of week (all 7 days).
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: ActivityByDayResponse }`
 */
async function getActivityByDay(req, res, next) {
  try {
    const { publicKey } = req.params;
    const data = await analyticsService.getActivityByDay(publicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/:publicKey/cohorts
 * Returns repeat vs one-time counterparties grouped by period.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} req.query
 * @param {"week"|"month"} [req.query.period] - Cohort bucket size, defaults to "month"
 * @param {string} [req.query.periods] - Number of buckets to return (max 12, default 6)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: CohortBreakdownResponse }`
 */
async function getCohortBreakdown(req, res, next) {
  try {
    const { publicKey } = req.params;
    const { period, periods } = req.query;
    const data = await analyticsService.getCohortBreakdown(publicKey, { period, periods });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/:publicKey/stream
 * Server-sent events stream for new payment operations.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} res - Express response (kept open as a `text/event-stream`)
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} SSE stream emitting `event: payment` with a JSON-encoded
 *   PaymentRecord-like payload, `event: error` with `{ message: string }`, and periodic
 *   `: heartbeat` comments
 */
async function streamPayments(req, res, next) {
  try {
    const { publicKey } = req.params;

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Backpressure-aware writer (#841): buffers frames while the socket is
    // full and flushes on 'drain', terminating a permanently-stalled client.
    const writer = createSseWriter(res);

    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    writer.write("retry: 5000\n\n");

    // Keep-alive pings + stale-connection termination (#841).
    const stopHeartbeat = heartbeatPing(res, writer);

    const stopStream = stellarService.streamPaymentEvents(publicKey, {
      onPayment: (payment) => {
        writer.write(`event: payment\ndata: ${JSON.stringify(payment)}\n\n`);
      },
      onError: (error) => {
        writer.write(
          `event: error\ndata: ${JSON.stringify({
            message: error instanceof Error ? error.message : "Payment stream error",
          })}\n\n`
        );
      },
    });

    // Idempotent cleanup: stop timers/stream, release the connection slot held
    // by the limiter, and end the response. Guarded so it only runs once no
    // matter how many of these events fire first.
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      stopHeartbeat();
      stopStream();
      releaseConnection(res);
      writer.end();
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
    req.on("end", cleanup);
    req.socket?.on("error", cleanup);
    res.on("close", cleanup);
  } catch (err) {
    // Ensure the limiter slot is released if we error out mid-setup.
    releaseConnection(res);
    next(err);
  }
}

/**
 * POST /api/analytics/:publicKey/export-schedule
 * Set up recurring email export.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} req.body
 * @param {string} req.body.email - Destination email address
 * @param {"daily"|"weekly"} req.body.frequency - Export cadence
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} 201 JSON: `{ success: true, data: { publicKey: string, email: string,
 *   frequency: string, nextRunAt: string }, message: string }`
 */
async function scheduleExport(req, res, next) {
  try {
    const { publicKey } = req.params;
    const { email, frequency } = req.body;
    const data = analyticsService.scheduleExport(publicKey, email, frequency);
    res.status(201).json({ success: true, data, message: "Recurring export scheduled successfully" });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/:publicKey/export-schedule
 * Get scheduled export configuration.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: { publicKey: string, email: string,
 *   frequency: string, nextRunAt: string } | null }`
 */
async function getExportSchedule(req, res, next) {
  try {
    const { publicKey } = req.params;
    const data = analyticsService.getExportSchedule(publicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/analytics/:publicKey/export-trigger
 * Manually trigger sending export email.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.publicKey - Stellar public key (G...)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: { success: true }, message: string }`,
 *   or 404 (via next) when no export schedule exists for this public key
 */
async function triggerExport(req, res, next) {
  try {
    const { publicKey } = req.params;
    const data = await analyticsService.triggerEmailExport(publicKey);
    res.json({ success: true, data, message: "Export email sent" });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSummary,
  getTopRecipients,
  getActivityByDay,
  getCohortBreakdown,
  streamPayments,
  scheduleExport,
  getExportSchedule,
  triggerExport,
};

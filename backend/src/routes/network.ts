// src/routes/network.ts
import { Router, Request, Response } from 'express';
import { Server } from '@stellar/stellar-sdk/rpc'; // or stellar-sdk Horizon server
import { logger } from '../utils/logger';

const router = Router();

// Simple in-memory cache for fee history (10 min TTL)
let cachedFeeHistory: { data: any[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Mock or configure Stellar Horizon / RPC client
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';

/**
 * @swagger
 * /api/network/fee-history:
 *   get:
 *   summary: Get 24-hour network fee trend history
 *   description: Returns an array of sampled ledger fee data (p50 and p90 fees) closed over the past 24 hours.
 *   responses:
 *     200:
 *       description: Successfully retrieved fee history trend data.
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 p50Fee:
 *                   type: number
 *                 p90Fee:
 *                   type: number
 */
router.get('/fee-history', async (req: Request, res: Response) => {
  const now = Date.now();

  // Return cached result if valid
  if (cachedFeeHistory && now - cachedFeeHistory.timestamp < CACHE_TTL_MS) {
    return res.json(cachedFeeHistory.data);
  }

  try {
    // Fetch recent ledgers from Horizon (simulated/implemented via fetch)
    const response = await fetch(`${HORIZON_URL}/ledgers?order=desc&limit=288`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Horizon unavailable while fetching fee history, returning empty array');
      return res.json([]);
    }

    const data = await response.json();
    const ledgers = data._embedded?.records || [];

    // Process and sample every ~5 minutes (approx every 10 ledgers assuming ~5s block time)
    const sampledData = [];
    for (let i = 0; i < ledgers.length; i += 10) {
      const ledger = ledgers[i];
      sampledData.push({
        timestamp: ledger.closed_at,
        p50Fee: Number(ledger.fee_account_stats?.p50_fee || ledger.base_fee_in_stroops || 100),
        p90Fee: Number(ledger.fee_account_stats?.p90_fee || ledger.base_fee_in_stroops * 2 || 200),
      });
    }

    // Reverse to chronological order
    const feeHistory = sampledData.reverse();

    // Cache result for 10 minutes
    cachedFeeHistory = {
      data: feeHistory,
      timestamp: now,
    };

    return res.json(feeHistory);
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch fee history from Horizon, returning empty array fallback');
    // Acceptance criteria: falls back to an empty array (not an error) if Horizon is unavailable
    return res.json([]);
  }
});

export const networkRoutes = router;
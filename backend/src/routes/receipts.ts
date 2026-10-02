import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_placeholder';
const EXPIRY_SECONDS = 15 * 60; // 15 minutes

/**
 * @route POST /api/receipts/generate
 * @desc Generates a time-limited signed URL for payment receipt download
 */
router.post('/generate', (req: Request, res: Response) => {
  const { txHash } = req.body;

  if (!txHash) {
    return res.status(400).json({ error: 'Transaction hash (txHash) is required' });
  }

  const expiresAt = Date.now() + EXPIRY_SECONDS * 1000;

  // Sign token using JWT_SECRET with 15-minute expiration
  const signedToken = jwt.sign({ txHash }, JWT_SECRET, { expiresIn: `${EXPIRY_SECONDS}s` });
  const downloadUrl = `/api/receipts/${signedToken}`;

  logger.info({ txHash, expiresAt }, 'Generated signed receipt download URL');

  return res.json({
    url: downloadUrl,
    expiresAt: new Date(expiresAt).toISOString(),
  });
});

/**
 * @route GET /api/receipts/:signedToken
 * @desc Validates signed token and returns receipt data or 410 Gone if expired
 */
router.get('/:signedToken', (req: Request, res: Response) => {
  const { signedToken } = req.params;

  try {
    const decoded = jwt.verify(signedToken, JWT_SECRET) as { txHash: string };

    // Mock receipt retrieval based on txHash
    const receiptData = {
      txHash: decoded.txHash,
      status: 'success',
      amount: '10.0000000 XLM',
      timestamp: new Date().toISOString(),
    };

    return res.json(receiptData);
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      logger.warn({ err: error }, 'Attempted to access expired receipt download link');
      // Acceptance criteria: Expired tokens return 410 Gone
      return res.status(410).json({ error: 'Receipt download link has expired' });
    }

    logger.error({ err: error }, 'Invalid receipt download token');
    return res.status(400).json({ error: 'Invalid or malformed receipt token' });
  }
});

export const receiptRoutes = router;
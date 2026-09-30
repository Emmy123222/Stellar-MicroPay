// src/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// Extend Express Request type to include user payload if not already defined
interface AuthenticatedRequest extends Request {
  user?: {
    publicKey?: string;
    [key: string]: any;
  };
}

export const authenticatedRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per window per public key
  standardHeaders: true, // Return standard rate limit headers (`RateLimit-*`)
  legacyHeaders: false,
  keyGenerator: (req: AuthenticatedRequest): string => {
    const key = req.user?.publicKey || req.ip || 'unknown';
    return key;
  },
  handler: (req: Request, res: Response) => {
    res.setHeader('X-RateLimit-Key', (req as AuthenticatedRequest).user?.publicKey || req.ip || 'unknown');
    res.status(429).json({
      error: 'Too many requests, please try again later.',
      retryAfter: res.getHeader('Retry-After'),
    });
  },
  skip: (req: Request) => {
    // Optional: skip certain paths if needed
    return false;
  },
});

// Helper to attach X-RateLimit-Key header for debugging on successful responses
export const attachRateLimitKeyHeader = (req: AuthenticatedRequest, res: Response, next: Function) => {
  const key = req.user?.publicKey || req.ip || 'unknown';
  res.setHeader('X-RateLimit-Key', key);
  next();
};
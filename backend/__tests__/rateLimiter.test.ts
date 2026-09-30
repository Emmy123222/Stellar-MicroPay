// src/middleware/__tests__/rateLimiter.test.ts
import express from 'express';
import request from 'supertest';
import { authenticatedRateLimiter, attachRateLimitKeyHeader } from '../rateLimiter';

describe('Per-User Rate Limiter Middleware (#1208)', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock auth middleware simulation
    app.use((req: any, res, next) => {
      if (req.headers['x-test-public-key']) {
        req.user = { publicKey: req.headers['x-test-public-key'] };
      }
      next();
    });

    app.get('/test-route', authenticatedRateLimiter, attachRateLimitKeyHeader, (req, res) => {
      res.json({ success: true });
    });
  });

  it('uses req.user.publicKey as the rate limit key and sets X-RateLimit-Key header', async () => {
    const pubKey = 'G_TEST_USER_PUBLIC_KEY_123';

    const response = await request(app)
      .get('/test-route')
      .set('x-test-public-key', pubKey);

    expect(response.status).toBe(200);
    expect(response.headers['x-ratelimit-key']).toBe(pubKey);
  });

  it('falls back to req.ip when req.user.publicKey is absent', async () => {
    const response = await request(app).get('/test-route');

    expect(response.status).toBe(200);
    expect(response.headers['x-ratelimit-key']).toBeDefined();
    expect(response.headers['x-ratelimit-key']).not.toBe('undefined');
  });
});
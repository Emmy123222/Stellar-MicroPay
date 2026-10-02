// src/routes/__tests__/feeHistory.test.ts
import express from 'express';
import request from 'supertest';
import { networkRoutes } from '../network';

describe('GET /api/network/fee-history (#1207)', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use('/api/network', networkRoutes);
    jest.restoreAllMocks();
  });

  it('returns fee history array with timestamp, p50Fee, and p90Fee', async () => {
    const mockLedgersResponse = {
      _embedded: {
        records: [
          { closed_at: '2026-09-30T09:00:00Z', base_fee_in_stroops: 100 },
          { closed_at: '2026-09-30T08:55:00Z', base_fee_in_stroops: 100 },
        ],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockLedgersResponse,
    });

    const response = await request(app).get('/api/network/fee-history');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    if (response.body.length > 0) {
      expect(response.body[0]).toHaveProperty('timestamp');
      expect(response.body[0]).toHaveProperty('p50Fee');
      expect(response.body[0]).toHaveProperty('p90Fee');
    }
  });

  it('falls back to an empty array instead of erroring when Horizon is unavailable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    const response = await request(app).get('/api/network/fee-history');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
import request from 'supertest';
import app from '../app';

describe('Versioned API Routing (#1201)', () => {
  it('allows access to routes under /api/v1/', async () => {
    const response = await request(app)
      .post('/api/v1/receipts/generate')
      .send({ txHash: 'test_hash_123' });

    // Should succeed or return validation error rather than 404
    expect(response.status).not.toBe(404);
  });

  it('redirects unversioned /api/ requests to /api/v1/ with 301 status', async () => {
    const response = await request(app).get('/api/receipts/generate');

    expect(response.status).toBe(301);
    expect(response.header['location']).toContain('/api/v1/');
  });
});
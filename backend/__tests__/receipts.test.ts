import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { receiptRoutes } from '../receipts';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_placeholder';

describe('Receipts Signed URL Endpoints (#1206)', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/receipts', receiptRoutes);
  });

  it('POST /api/receipts/generate returns url and expiresAt', async () => {
    const response = await request(app)
      .post('/api/receipts/generate')
      .send({ txHash: 'abc123hash' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('url');
    expect(response.body).toHaveProperty('expiresAt');
    expect(response.body.url).toContain('/api/receipts/');
  });

  it('GET /api/receipts/:signedToken returns receipt data for valid token', async () => {
    const token = jwt.sign({ txHash: 'abc123hash' }, JWT_SECRET, { expiresIn: '15m' });

    const response = await request(app).get(`/api/receipts/${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      txHash: 'abc123hash',
      status: 'success',
    });
  });

  it('GET /api/receipts/:signedToken returns 410 Gone when token is expired', async () => {
    // Generate an already expired token (-1s)
    const expiredToken = jwt.sign({ txHash: 'abc123hash' }, JWT_SECRET, { expiresIn: '-1s' });

    const response = await request(app).get(`/api/receipts/${expiredToken}`);

    expect(response.status).toBe(410);
    expect(response.body).toEqual({
      error: 'Receipt download link has expired',
    });
  });
});
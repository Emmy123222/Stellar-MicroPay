const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { verifyJWT, JWT_SECRET } = require('../src/middleware/auth');

describe('Auth Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Dummy route to test middleware
    app.get('/protected', verifyJWT, (req, res) => {
      res.status(200).json({ user: req.user });
    });
  });

  it('Valid JWT \u2192 req.user set correctly, next() called', async () => {
    const payload = { publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toBeDefined();
    expect(response.body.user.publicKey).toBe(payload.publicKey);
  });

  it('Expired JWT \u2192 401 response', async () => {
    const payload = { publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '-1h' }); // Expired 1 hour ago

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized: invalid or expired token');
  });

  it('Missing Authorization header \u2192 401 response', async () => {
    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized: missing or invalid token');
  });

  it('Token signed with wrong secret \u2192 401 response', async () => {
    const payload = { publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ' };
    const wrongSecret = 'wrong_secret_key';
    const token = jwt.sign(payload, wrongSecret, { expiresIn: '1h' });

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized: invalid or expired token');
  });
});

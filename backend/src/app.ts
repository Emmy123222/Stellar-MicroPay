// src/app.ts
import express, { Application, Request, Response } from 'express';
import { receiptRoutes } from './routes/receipts';
// Import other route modules (e.g., paymentRoutes, etc.)

const app: Application = express();

app.use(express.json());

// 1. Mount existing routes under /api/v1/
const v1Router = express.Router();
v1Router.use('/receipts', receiptRoutes);
// v1Router.use('/payments', paymentRoutes);

app.use('/api/v1', v1Router);

// 2. Backwards compatibility redirect: /api/ -> /api/v1/ with 301 Moved Permanently
app.all('/api', (req: Request, res: Response) => {
  res.redirect(301, '/api/v1/');
});

app.all('/api/*', (req: Request, res: Response) => {
  const newPath = req.originalUrl.replace(/^\/api/, '/api/v1');
  res.redirect(301, newPath);
});

export default app;
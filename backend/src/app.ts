import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import { env } from './config/env';
import { AppError } from './lib/errors';
import { authRouter } from './modules/auth/auth.routes';
import { salaryRouter } from './modules/salaries/salaries.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { setupRouter } from './modules/setup/setup.routes';
import { businessRouter } from './modules/business/business.routes';
import { userRouter } from './modules/users/users.routes';
import { supplierRouter } from './modules/suppliers/suppliers.routes';
import { farmerRouter } from './modules/farmers/farmers.routes';
import { categoryRouter } from './modules/categories/categories.routes';
import { productRouter } from './modules/products/products.routes';
import { purchaseRouter } from './modules/purchases/purchases.routes';
import { purchaseReturnRouter } from './modules/purchases/purchaseReturns.routes';
import { saleRouter } from './modules/sales/sales.routes';
import { saleReturnRouter } from './modules/sales/saleReturns.routes';
import { farmerPaymentRouter } from './modules/payments/farmerPayments.routes';
import { supplierPaymentRouter } from './modules/payments/supplierPayments.routes';
import { expenseRouter } from './modules/expenses/expenses.routes';
import { accountRouter } from './modules/accounts/accounts.routes';
import { taskRouter } from './modules/tasks/tasks.routes';
import { reportRouter } from './modules/reports/reports.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Behind Caddy/nginx in production: without this, express-rate-limit buckets
  // every request under the proxy's IP and req.ip is useless in the audit log.
  if (env.isProduction) app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: false, // bearer-token auth, not cookies — see lib/session.ts
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  if (env.NODE_ENV !== 'test') {
    app.use(pinoHttp({ redact: ['req.headers.authorization'] }));
  }

  // Login is rate-limited to blunt credential-stuffing / brute force.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
  });
  app.use('/api/auth/login', loginLimiter);

  // A general ceiling on every other API route, generous enough for normal
  // invoice-entry use but enough to blunt an automated hammering of the API.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/business', businessRouter);
  app.use('/api/users', userRouter);
  app.use('/api/suppliers', supplierRouter);
  app.use('/api/farmers', farmerRouter);
  app.use('/api/categories', categoryRouter);
  app.use('/api/products', productRouter);
  app.use('/api/purchases', purchaseRouter);
  app.use('/api/purchase-returns', purchaseReturnRouter);
  app.use('/api/sales', saleRouter);
  app.use('/api/sale-returns', saleReturnRouter);
  app.use('/api/farmer-payments', farmerPaymentRouter);
  app.use('/api/supplier-payments', supplierPaymentRouter);
  app.use('/api/expenses', expenseRouter);
  app.use('/api/accounts', accountRouter);
  app.use('/api/tasks', taskRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/salaries', salaryRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/dashboard', dashboardRouter);

  app.use((_req, _res, next) => next(AppError.notFound('Route not found')));

  // Centralized error handler: never leak stack traces or raw DB errors to
  // the client, but log them server-side for debugging.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log?.error({ err }, err.message);
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: err.flatten() });
    }
    req.log?.error({ err }, 'Unhandled error');
    if (env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

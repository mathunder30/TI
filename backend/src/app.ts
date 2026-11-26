import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { authRouter } from './auth/router.js';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { healthRouter } from './routes/health.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Muitas solicitações. Tente novamente em instantes.' } },
  }),
);
app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use(notFoundHandler);
app.use(errorHandler);

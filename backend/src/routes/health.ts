import { Router } from 'express';
import { prisma } from '../db/prisma.js';

export const healthRouter = Router();

healthRouter.get('/live', (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'portal-chamados-api' });
});

healthRouter.get('/ready', async (_request, response, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.status(200).json({ status: 'ready', dependencies: { mysql: 'ok' } });
  } catch (error) {
    next(error);
  }
});

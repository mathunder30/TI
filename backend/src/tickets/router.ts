import { Router, type RequestHandler } from 'express';
import type { PrismaClient } from '../generated/prisma/client.ts';
import { prisma } from '../db/prisma.js';
import {
  requireAuthenticatedSession,
  requireCsrf,
  requireSameOrigin,
  getAuthContext,
} from '../auth/middleware.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { HttpError } from '../http/errors.js';
import { createTicketInTransaction } from './service.js';
import { createTicketSchema } from './validation.js';

type TicketRouterDependencies = {
  database: PrismaClient;
  now: () => Date;
};

const productionDependencies: TicketRouterDependencies = {
  database: prisma,
  now: () => new Date(),
};

export function createTicketsRouter(dependencies = productionDependencies) {
  const router = Router();
  const requireFuncionario: RequestHandler = (request, _response, next) => {
    const auth = getAuthContext(request as AuthenticatedRequest);
    if (auth.user.role !== 'FUNCIONARIO') {
      next(new HttpError(403, 'Somente funcionários podem abrir chamados.'));
      return;
    }
    next();
  };

  router.post(
    '/',
    requireSameOrigin,
    requireAuthenticatedSession,
    requireCsrf,
    requireFuncionario,
    async (request, response) => {
      const parsed = createTicketSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new HttpError(
          400,
          'Informe título, descrição, categoria ativa e prioridade válidos.',
        );
      }

      const auth = getAuthContext(request as AuthenticatedRequest);
      const ticket = await dependencies.database.$transaction((transaction) =>
        createTicketInTransaction(transaction, auth.user.id, parsed.data, dependencies.now()),
      );
      response.status(201).json({ ticket });
    },
  );

  return router;
}

export const ticketsRouter = createTicketsRouter();

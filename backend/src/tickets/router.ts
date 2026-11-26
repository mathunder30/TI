import { Router, type RequestHandler } from 'express';
import {
  TicketEventType,
  TicketPriority,
  TicketStatus,
  type Prisma,
  type PrismaClient,
} from '../generated/prisma/client.ts';
import {
  getAuthContext,
  requireAuthenticatedSession,
  requireCsrf,
  requireSameOrigin,
} from '../auth/middleware.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../http/errors.js';
import { createTicketInTransaction } from './service.js';
import { createTicketSchema, listTicketsQuerySchema } from './validation.js';

type TicketRouterDependencies = {
  database: PrismaClient;
  now: () => Date;
};

const productionDependencies: TicketRouterDependencies = {
  database: prisma,
  now: () => new Date(),
};

const PUBLIC_HISTORY_EVENTS = [
  TicketEventType.ABERTURA,
  TicketEventType.ALTERACAO_STATUS,
  TicketEventType.ALTERACAO_PRIORIDADE,
  TicketEventType.SOLUCAO,
  TicketEventType.REABERTURA,
  TicketEventType.ENCERRAMENTO,
  TicketEventType.CANCELAMENTO,
  TicketEventType.ANEXO,
] as const;

type PublicHistoryEvent = (typeof PUBLIC_HISTORY_EVENTS)[number];

const publicEventLabels: Record<PublicHistoryEvent, string> = {
  [TicketEventType.ABERTURA]: 'Chamado aberto',
  [TicketEventType.ALTERACAO_STATUS]: 'Status atualizado',
  [TicketEventType.ALTERACAO_PRIORIDADE]: 'Prioridade atualizada',
  [TicketEventType.SOLUCAO]: 'Solução registrada',
  [TicketEventType.REABERTURA]: 'Chamado reaberto',
  [TicketEventType.ENCERRAMENTO]: 'Chamado encerrado',
  [TicketEventType.CANCELAMENTO]: 'Chamado cancelado',
  [TicketEventType.ANEXO]: 'Anexo registrado',
};

const statusLabels: Record<TicketStatus, string> = {
  [TicketStatus.ABERTO]: 'Aberto',
  [TicketStatus.EM_TRIAGEM]: 'Em triagem',
  [TicketStatus.EM_ATENDIMENTO]: 'Em atendimento',
  [TicketStatus.AGUARDANDO_FUNCIONARIO]: 'Aguardando você',
  [TicketStatus.RESOLVIDO]: 'Resolvido',
  [TicketStatus.FECHADO]: 'Fechado',
  [TicketStatus.REABERTO]: 'Reaberto',
  [TicketStatus.CANCELADO]: 'Cancelado',
};

const priorityLabels: Record<TicketPriority, string> = {
  [TicketPriority.BAIXA]: 'Baixa',
  [TicketPriority.MEDIA]: 'Média',
  [TicketPriority.ALTA]: 'Alta',
  [TicketPriority.CRITICA]: 'Crítica',
};

const requireFuncionario: RequestHandler = (request, _response, next) => {
  const auth = getAuthContext(request as AuthenticatedRequest);
  if (auth.user.role !== 'FUNCIONARIO') {
    next(new HttpError(403, 'A área de chamados é exclusiva para funcionários.'));
    return;
  }
  next();
};

function toTicketListDto(ticket: {
  id: string;
  number: string;
  title: string;
  categoryNameSnapshot: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    category: ticket.categoryNameSnapshot,
    priority: ticket.priority,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

function valueLabel(eventType: PublicHistoryEvent, value: string | null): string | null {
  if (!value) return null;
  if (eventType === TicketEventType.ALTERACAO_STATUS) {
    return Object.hasOwn(statusLabels, value) ? statusLabels[value as TicketStatus] : null;
  }
  if (eventType === TicketEventType.ALTERACAO_PRIORIDADE) {
    return Object.hasOwn(priorityLabels, value) ? priorityLabels[value as TicketPriority] : null;
  }
  if (eventType === TicketEventType.ABERTURA && value === TicketStatus.ABERTO) {
    return statusLabels[TicketStatus.ABERTO];
  }
  return null;
}

export function createTicketsRouter(dependencies = productionDependencies) {
  const router = Router();
  router.use(requireAuthenticatedSession, requireFuncionario);

  router.get('/categories', async (_request, response) => {
    const categories = await dependencies.database.ticketCategory.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
    response.json({ categories });
  });

  router.get('/', async (request, response) => {
    const parsed = listTicketsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, 'Os filtros ou parâmetros de paginação são inválidos.');
    }

    const auth = getAuthContext(request as AuthenticatedRequest);
    const { page, pageSize, status, priority, categoryId, q } = parsed.data;
    const where: Prisma.TicketWhereInput = {
      requesterUserId: auth.user.id,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(q
        ? {
            OR: [{ number: { contains: q } }, { title: { contains: q } }],
          }
        : {}),
    };
    const [totalItems, tickets] = await dependencies.database.$transaction((transaction) =>
      Promise.all([
        transaction.ticket.count({ where }),
        transaction.ticket.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            number: true,
            title: true,
            categoryNameSnapshot: true,
            priority: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]),
    );
    const totalPages = Math.ceil(totalItems / pageSize);
    response.json({
      items: tickets.map(toTicketListDto),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
    });
  });

  router.get('/:ticketId/timeline', async (request, response) => {
    const auth = getAuthContext(request as AuthenticatedRequest);
    const ticketId = request.params.ticketId;
    if (typeof ticketId !== 'string' || ticketId.length > 30) {
      throw new HttpError(404, 'Chamado não encontrado.');
    }

    const timeline = await dependencies.database.$transaction(async (transaction) => {
      const ticket = await transaction.ticket.findFirst({
        where: { id: ticketId, requesterUserId: auth.user.id },
        select: { id: true },
      });
      if (!ticket) throw new HttpError(404, 'Chamado não encontrado.');

      const events = await transaction.ticketHistory.findMany({
        where: {
          ticketId: ticket.id,
          eventType: { in: [...PUBLIC_HISTORY_EVENTS] },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          eventType: true,
          createdAt: true,
          actorUserId: true,
          previousValue: true,
          newValue: true,
        },
      });

      return events.map((event) => {
        const eventType = event.eventType as PublicHistoryEvent;
        return {
          id: event.id,
          type: eventType,
          label: publicEventLabels[eventType],
          createdAt: event.createdAt,
          actor: event.actorUserId === auth.user.id ? 'Você' : event.actorUserId ? 'TI' : 'Sistema',
          from: valueLabel(eventType, event.previousValue),
          to: valueLabel(eventType, event.newValue),
        };
      });
    });

    response.json({ timeline });
  });

  router.get('/:ticketId', async (request, response) => {
    const auth = getAuthContext(request as AuthenticatedRequest);
    const ticketId = request.params.ticketId;
    if (typeof ticketId !== 'string' || ticketId.length > 30) {
      throw new HttpError(404, 'Chamado não encontrado.');
    }

    const ticket = await dependencies.database.ticket.findFirst({
      where: { id: ticketId, requesterUserId: auth.user.id },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        suggestedPriority: true,
        requesterNameSnapshot: true,
        requesterEmailSnapshot: true,
        unitNameSnapshot: true,
        departmentNameSnapshot: true,
        categoryNameSnapshot: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!ticket) throw new HttpError(404, 'Chamado não encontrado.');

    response.json({
      ticket: {
        id: ticket.id,
        number: ticket.number,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        suggestedPriority: ticket.suggestedPriority,
        requester: {
          name: ticket.requesterNameSnapshot,
          email: ticket.requesterEmailSnapshot,
        },
        unit: ticket.unitNameSnapshot,
        department: ticket.departmentNameSnapshot,
        category: ticket.categoryNameSnapshot,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      },
    });
  });

  router.post('/', requireSameOrigin, requireCsrf, async (request, response) => {
    const parsed = createTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Informe título, descrição, categoria ativa e prioridade válidos.');
    }

    const auth = getAuthContext(request as AuthenticatedRequest);
    const ticket = await dependencies.database.$transaction((transaction) =>
      createTicketInTransaction(transaction, auth.user.id, parsed.data, dependencies.now()),
    );
    response.status(201).json({ ticket });
  });

  return router;
}

export const ticketsRouter = createTicketsRouter();

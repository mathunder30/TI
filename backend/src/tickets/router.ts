import { Router, type RequestHandler } from 'express';
import {
  CommentVisibility,
  TicketEventType,
  TicketPriority,
  TicketStatus,
  UserRole,
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
import {
  confirmTicketResolution,
  changeTicketStatus,
  createPublicMessage,
  reopenTicket,
  requestTicketInformation,
  resolveTicket,
} from './workflow.js';
import { readStoredAttachment, receiveAttachment, storeTicketAttachment } from './attachments.js';
import {
  createTicketSchema,
  listTicketsQuerySchema,
  ticketMessageSchema,
  ticketReasonSchema,
  ticketResolutionSchema,
  ticketStatusChangeSchema,
} from './validation.js';

type TicketRouterDependencies = { database: PrismaClient; now: () => Date };
const productionDependencies: TicketRouterDependencies = {
  database: prisma,
  now: () => new Date(),
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
const publicEventLabels: Partial<Record<TicketEventType, string>> = {
  [TicketEventType.ABERTURA]: 'Chamado aberto',
  [TicketEventType.ALTERACAO_STATUS]: 'Status atualizado',
  [TicketEventType.ALTERACAO_PRIORIDADE]: 'Prioridade atualizada',
  [TicketEventType.MENSAGEM]: 'Mensagem pública registrada',
  [TicketEventType.SOLUCAO]: 'Solução registrada',
  [TicketEventType.REABERTURA]: 'Reabertura solicitada',
  [TicketEventType.ENCERRAMENTO]: 'Chamado encerrado',
  [TicketEventType.CANCELAMENTO]: 'Chamado cancelado',
  [TicketEventType.ANEXO]: 'Anexo registrado',
};
const visibleHistoryEvents = Object.keys(publicEventLabels) as TicketEventType[];

const requireFuncionario: RequestHandler = (request, _response, next) => {
  const auth = getAuthContext(request as AuthenticatedRequest);
  if (auth.user.role !== UserRole.FUNCIONARIO) {
    next(new HttpError(403, 'Esta operação é exclusiva para funcionários.'));
    return;
  }
  next();
};

function requireTi(database: PrismaClient): RequestHandler {
  return async (request, _response, next) => {
    try {
      const auth = getAuthContext(request as AuthenticatedRequest);
      if (auth.user.role !== UserRole.TI)
        throw new HttpError(403, 'Esta operação é exclusiva para TI.');
      const administrator = await database.adminAccount.findUnique({
        where: { userId: auth.user.id },
        select: { userId: true },
      });
      if (!administrator) throw new HttpError(403, 'Conta sem autorização administrativa.');
      next();
    } catch (error) {
      next(error);
    }
  };
}

function authActor(request: AuthenticatedRequest) {
  const auth = getAuthContext(request);
  return { id: auth.user.id, fullName: auth.user.fullName, role: auth.user.role };
}

async function assertTicketAccess(
  database: PrismaClient,
  ticketId: string,
  actor: ReturnType<typeof authActor>,
) {
  if (actor.role === UserRole.TI) {
    const administrator = await database.adminAccount.findUnique({
      where: { userId: actor.id },
      select: { userId: true },
    });
    if (!administrator) throw new HttpError(403, 'Conta sem autorização administrativa.');
    const ticket = await database.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!ticket) throw new HttpError(404, 'Chamado não encontrado.');
    return;
  }
  const ticket = await database.ticket.findFirst({
    where: { id: ticketId, requesterUserId: actor.id },
    select: { id: true },
  });
  if (!ticket) throw new HttpError(404, 'Chamado não encontrado.');
}

function ticketIdFrom(request: import('express').Request) {
  const ticketId = request.params.ticketId;
  if (typeof ticketId !== 'string' || ticketId.length > 30)
    throw new HttpError(404, 'Chamado não encontrado.');
  return ticketId;
}

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

function ticketDetailDto(ticket: {
  id: string;
  number: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  suggestedPriority: TicketPriority;
  requesterNameSnapshot: string;
  requesterEmailSnapshot: string;
  unitNameSnapshot: string;
  departmentNameSnapshot: string;
  categoryNameSnapshot: string;
  resolution: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    suggestedPriority: ticket.suggestedPriority,
    requester: { name: ticket.requesterNameSnapshot, email: ticket.requesterEmailSnapshot },
    unit: ticket.unitNameSnapshot,
    department: ticket.departmentNameSnapshot,
    category: ticket.categoryNameSnapshot,
    resolution: ticket.resolution,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

function toTimelineValue(eventType: TicketEventType, value: string | null) {
  if (
    eventType === TicketEventType.ALTERACAO_STATUS &&
    value &&
    Object.hasOwn(statusLabels, value)
  ) {
    return statusLabels[value as TicketStatus];
  }
  if (
    eventType === TicketEventType.ALTERACAO_PRIORIDADE &&
    value &&
    Object.hasOwn(priorityLabels, value)
  ) {
    return priorityLabels[value as TicketPriority];
  }
  if (eventType === TicketEventType.ABERTURA && value === TicketStatus.ABERTO)
    return statusLabels.ABERTO;
  return null;
}

export function createTicketsRouter(dependencies = productionDependencies) {
  const { database } = dependencies;
  const router = Router();
  router.use(requireAuthenticatedSession);

  router.get('/categories', requireFuncionario, async (_request, response) => {
    const categories = await database.ticketCategory.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
    response.json({ categories });
  });

  router.get('/ti', requireTi(database), async (request, response) => {
    const parsed = listTicketsQuerySchema.safeParse(request.query);
    if (!parsed.success)
      throw new HttpError(400, 'Os filtros ou parâmetros de paginação são inválidos.');
    const { page, pageSize, status, priority, categoryId, q } = parsed.data;
    const where: Prisma.TicketWhereInput = {
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(q ? { OR: [{ number: { contains: q } }, { title: { contains: q } }] } : {}),
    };
    const [totalItems, tickets] = await database.$transaction((transaction) =>
      Promise.all([
        transaction.ticket.count({ where }),
        transaction.ticket.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
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
            requesterNameSnapshot: true,
            unitNameSnapshot: true,
          },
        }),
      ]),
    );
    const totalPages = Math.ceil(totalItems / pageSize);
    response.json({
      items: tickets.map((ticket) => ({
        ...toTicketListDto(ticket),
        requester: ticket.requesterNameSnapshot,
        unit: ticket.unitNameSnapshot,
      })),
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

  router.get('/', requireFuncionario, async (request, response) => {
    const parsed = listTicketsQuerySchema.safeParse(request.query);
    if (!parsed.success)
      throw new HttpError(400, 'Os filtros ou parâmetros de paginação são inválidos.');
    const { page, pageSize, status, priority, categoryId, q } = parsed.data;
    const auth = getAuthContext(request as AuthenticatedRequest);
    const where: Prisma.TicketWhereInput = {
      requesterUserId: auth.user.id,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(q ? { OR: [{ number: { contains: q } }, { title: { contains: q } }] } : {}),
    };
    const [totalItems, tickets] = await database.$transaction((transaction) =>
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
    const actor = authActor(request as AuthenticatedRequest);
    const ticketId = ticketIdFrom(request);
    await assertTicketAccess(database, ticketId, actor);
    const timeline = await database.ticketHistory.findMany({
      where: {
        ticketId,
        eventType: { in: visibleHistoryEvents },
        ...(actor.role === UserRole.FUNCIONARIO
          ? { ticket: { is: { id: ticketId, requesterUserId: actor.id } } }
          : {}),
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
    response.json({
      timeline: timeline.map((event) => ({
        id: event.id,
        type: event.eventType,
        label: publicEventLabels[event.eventType] ?? 'Atualização',
        createdAt: event.createdAt,
        actor: event.actorUserId === actor.id ? 'Você' : event.actorUserId ? 'TI' : 'Sistema',
        from: toTimelineValue(event.eventType, event.previousValue),
        to: toTimelineValue(event.eventType, event.newValue),
      })),
    });
  });

  router.get('/:ticketId/messages', async (request, response) => {
    const actor = authActor(request as AuthenticatedRequest);
    const ticketId = ticketIdFrom(request);
    await assertTicketAccess(database, ticketId, actor);
    const messages = await database.ticketComment.findMany({
      where: {
        ticketId,
        visibility: CommentVisibility.PUBLICA,
        ...(actor.role === UserRole.FUNCIONARIO
          ? { ticket: { is: { id: ticketId, requesterUserId: actor.id } } }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        authorNameSnapshot: true,
        authorUserId: true,
        body: true,
        createdAt: true,
      },
    });
    response.json({
      messages: messages.map((message) => ({
        id: message.id,
        authorNameSnapshot: message.authorNameSnapshot,
        author: message.authorUserId === actor.id ? 'Você' : 'TI',
        body: message.body,
        createdAt: message.createdAt,
      })),
    });
  });

  router.get('/:ticketId/attachments', async (request, response) => {
    const actor = authActor(request as AuthenticatedRequest);
    const ticketId = ticketIdFrom(request);
    await assertTicketAccess(database, ticketId, actor);
    const attachments = await database.ticketAttachment.findMany({
      where: {
        ticketId,
        ...(actor.role === UserRole.FUNCIONARIO
          ? { ticket: { is: { id: ticketId, requesterUserId: actor.id } } }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        byteSize: true,
        createdAt: true,
        uploaderNameSnapshot: true,
        uploadedByUserId: true,
      },
    });
    response.json({
      attachments: attachments.map(({ uploadedByUserId, ...item }) => ({
        ...item,
        uploader: uploadedByUserId === actor.id ? 'Você' : 'TI',
      })),
    });
  });

  router.get('/:ticketId/attachments/:attachmentId', async (request, response) => {
    const actor = authActor(request as AuthenticatedRequest);
    const ticketId = ticketIdFrom(request);
    await assertTicketAccess(database, ticketId, actor);
    const attachmentId = request.params.attachmentId;
    if (typeof attachmentId !== 'string' || attachmentId.length > 30)
      throw new HttpError(404, 'Anexo não encontrado.');
    const attachment = await database.ticketAttachment.findFirst({
      where: {
        id: attachmentId,
        ticketId,
        ...(actor.role === UserRole.FUNCIONARIO
          ? { ticket: { is: { id: ticketId, requesterUserId: actor.id } } }
          : {}),
      },
      select: { storageKey: true, mimeType: true, originalName: true, byteSize: true },
    });
    if (!attachment) throw new HttpError(404, 'Anexo não encontrado.');
    const content = await readStoredAttachment(attachment.storageKey);
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Length', String(attachment.byteSize));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(content);
  });

  router.get('/:ticketId', async (request, response) => {
    const actor = authActor(request as AuthenticatedRequest);
    const ticketId = ticketIdFrom(request);
    await assertTicketAccess(database, ticketId, actor);
    const ticket = await database.ticket.findUnique({
      where: {
        id: ticketId,
        ...(actor.role === UserRole.FUNCIONARIO ? { requesterUserId: actor.id } : {}),
      },
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
        resolution: true,
        resolvedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!ticket) throw new HttpError(404, 'Chamado não encontrado.');
    response.json({ ticket: ticketDetailDto(ticket) });
  });

  router.post('/:ticketId/messages', requireSameOrigin, requireCsrf, async (request, response) => {
    const actor = authActor(request as AuthenticatedRequest);
    const ticketId = ticketIdFrom(request);
    const parsed = ticketMessageSchema.safeParse(request.body);
    if (!parsed.success)
      throw new HttpError(400, 'A mensagem deve conter entre 1 e 5.000 caracteres.');
    await assertTicketAccess(database, ticketId, actor);
    const message = await createPublicMessage(database, ticketId, actor, parsed.data.body);
    response.status(201).json({
      message: {
        id: message.id,
        author: actor.fullName,
        body: message.body,
        createdAt: message.createdAt,
      },
    });
  });

  router.post(
    '/:ticketId/attachments',
    requireSameOrigin,
    requireCsrf,
    receiveAttachment,
    async (request, response) => {
      const actor = authActor(request as AuthenticatedRequest);
      const ticketId = ticketIdFrom(request);
      await assertTicketAccess(database, ticketId, actor);
      const attachment = await storeTicketAttachment(database, ticketId, actor, request.file);
      response
        .status(201)
        .json({ attachment: { ...attachment, byteSize: Number(attachment.byteSize) } });
    },
  );

  router.post(
    '/:ticketId/confirm-resolution',
    requireFuncionario,
    requireSameOrigin,
    requireCsrf,
    async (request, response) => {
      const actor = authActor(request as AuthenticatedRequest);
      const ticket = await confirmTicketResolution(database, ticketIdFrom(request), actor);
      response.json({
        ticket: { id: ticket.id, status: ticket.status, closedAt: ticket.closedAt },
      });
    },
  );

  router.post(
    '/:ticketId/reopen',
    requireFuncionario,
    requireSameOrigin,
    requireCsrf,
    async (request, response) => {
      const actor = authActor(request as AuthenticatedRequest);
      const parsed = ticketReasonSchema.safeParse(request.body);
      if (!parsed.success)
        throw new HttpError(400, 'Informe o motivo da reabertura (10 a 2.000 caracteres).');
      const ticket = await reopenTicket(database, ticketIdFrom(request), actor, parsed.data.reason);
      response.json({ ticket: { id: ticket.id, status: ticket.status } });
    },
  );

  const requireTiRoute = requireTi(database);
  router.post(
    '/:ticketId/request-information',
    requireTiRoute,
    requireSameOrigin,
    requireCsrf,
    async (request, response) => {
      const actor = authActor(request as AuthenticatedRequest);
      const parsed = ticketMessageSchema.safeParse(request.body);
      if (!parsed.success)
        throw new HttpError(400, 'Informe a solicitação adicional (1 a 5.000 caracteres).');
      const message = await requestTicketInformation(
        database,
        ticketIdFrom(request),
        actor,
        parsed.data.body,
      );
      response.status(201).json({
        message: { id: message.id, body: message.body, createdAt: message.createdAt },
        status: TicketStatus.AGUARDANDO_FUNCIONARIO,
      });
    },
  );

  router.patch(
    '/:ticketId/status',
    requireTiRoute,
    requireSameOrigin,
    requireCsrf,
    async (request, response) => {
      const parsed = ticketStatusChangeSchema.safeParse(request.body);
      if (!parsed.success)
        throw new HttpError(400, 'Status permitido: EM_TRIAGEM ou EM_ATENDIMENTO.');
      const actor = authActor(request as AuthenticatedRequest);
      const ticket = await changeTicketStatus(
        database,
        ticketIdFrom(request),
        actor,
        parsed.data.status,
      );
      response.json({ ticket: { id: ticket.id, status: ticket.status } });
    },
  );

  router.post(
    '/:ticketId/resolve',
    requireTiRoute,
    requireSameOrigin,
    requireCsrf,
    async (request, response) => {
      const parsed = ticketResolutionSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, 'Informe a solução (10 a 5.000 caracteres).');
      const actor = authActor(request as AuthenticatedRequest);
      const ticket = await resolveTicket(
        database,
        ticketIdFrom(request),
        actor,
        parsed.data.resolution,
      );
      response.json({
        ticket: { id: ticket.id, status: ticket.status, resolvedAt: ticket.resolvedAt },
      });
    },
  );

  router.post(
    '/',
    requireFuncionario,
    requireSameOrigin,
    requireCsrf,
    async (request, response) => {
      const parsed = createTicketSchema.safeParse(request.body);
      if (!parsed.success)
        throw new HttpError(
          400,
          'Informe título, descrição, categoria ativa e prioridade válidos.',
        );
      const auth = getAuthContext(request as AuthenticatedRequest);
      const ticket = await database.$transaction((transaction) =>
        createTicketInTransaction(transaction, auth.user.id, parsed.data, dependencies.now()),
      );
      response.status(201).json({ ticket });
    },
  );

  return router;
}

export const ticketsRouter = createTicketsRouter();

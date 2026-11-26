import {
  CommentVisibility,
  TicketEventType,
  TicketStatus,
  UserRole,
  type Prisma,
  type PrismaClient,
} from '../generated/prisma/client.ts';
import { HttpError } from '../http/errors.js';

type Database = PrismaClient | Prisma.TransactionClient;
type Actor = { id: string; fullName: string; role: UserRole };

async function lockAndFindTicket(database: Database, ticketId: string, actor: Actor) {
  await database.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM tickets WHERE id = ${ticketId} FOR UPDATE
  `;
  const ticket = await database.ticket.findFirst({
    where: {
      id: ticketId,
      ...(actor.role === UserRole.FUNCIONARIO ? { requesterUserId: actor.id } : {}),
    },
  });
  if (!ticket) {
    throw new HttpError(404, 'Chamado não encontrado.');
  }
  return ticket;
}

async function logAdminAction(
  database: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  changes: Prisma.InputJsonValue,
) {
  if (actor.role !== UserRole.TI) return;
  await database.auditLog.create({
    data: {
      actorUserId: actor.id,
      actorNameSnapshot: actor.fullName,
      action,
      entityType,
      entityId,
      changes,
    },
  });
}

async function addHistory(
  database: Prisma.TransactionClient,
  ticketId: string,
  actor: Actor,
  eventType: TicketEventType,
  values: { previousValue?: string | null; newValue?: string | null; reason?: string | null } = {},
) {
  await database.ticketHistory.create({
    data: {
      ticketId,
      actorUserId: actor.id,
      actorNameSnapshot: actor.fullName,
      eventType,
      previousValue: values.previousValue ?? null,
      newValue: values.newValue ?? null,
      reason: values.reason ?? null,
    },
  });
}

export async function createPublicMessage(
  database: PrismaClient,
  ticketId: string,
  actor: Actor,
  body: string,
) {
  return database.$transaction(async (transaction) => {
    const ticket = await lockAndFindTicket(transaction, ticketId, actor);
    if (
      ([TicketStatus.FECHADO, TicketStatus.CANCELADO] as TicketStatus[]).includes(ticket.status)
    ) {
      throw new HttpError(409, 'Este chamado não aceita novas mensagens.');
    }

    const comment = await transaction.ticketComment.create({
      data: {
        ticketId,
        authorUserId: actor.id,
        authorNameSnapshot: actor.fullName,
        visibility: CommentVisibility.PUBLICA,
        body,
      },
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.MENSAGEM, {
      newValue: comment.id,
    });

    if (
      actor.role === UserRole.FUNCIONARIO &&
      ticket.status === TicketStatus.AGUARDANDO_FUNCIONARIO
    ) {
      await transaction.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.EM_ATENDIMENTO, autoCloseAt: null },
      });
      await addHistory(transaction, ticketId, actor, TicketEventType.ALTERACAO_STATUS, {
        previousValue: TicketStatus.AGUARDANDO_FUNCIONARIO,
        newValue: TicketStatus.EM_ATENDIMENTO,
      });
    } else if (
      actor.role === UserRole.TI &&
      (
        [
          TicketStatus.ABERTO,
          TicketStatus.EM_TRIAGEM,
          TicketStatus.REABERTO,
          TicketStatus.AGUARDANDO_FUNCIONARIO,
        ] as TicketStatus[]
      ).includes(ticket.status)
    ) {
      await transaction.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.EM_ATENDIMENTO },
      });
      await addHistory(transaction, ticketId, actor, TicketEventType.ALTERACAO_STATUS, {
        previousValue: ticket.status,
        newValue: TicketStatus.EM_ATENDIMENTO,
      });
    }
    await logAdminAction(
      transaction,
      actor,
      'TICKET_PUBLIC_MESSAGE_CREATED',
      'TICKET_COMMENT',
      comment.id,
      {
        ticketId,
        visibility: CommentVisibility.PUBLICA,
      },
    );
    return comment;
  });
}

export async function requestTicketInformation(
  database: PrismaClient,
  ticketId: string,
  actor: Actor,
  message: string,
) {
  return database.$transaction(async (transaction) => {
    const ticket = await lockAndFindTicket(transaction, ticketId, actor);
    if (
      !(
        [
          TicketStatus.ABERTO,
          TicketStatus.EM_TRIAGEM,
          TicketStatus.EM_ATENDIMENTO,
          TicketStatus.REABERTO,
        ] as TicketStatus[]
      ).includes(ticket.status)
    ) {
      throw new HttpError(409, 'O chamado não pode aguardar informações neste status.');
    }
    const comment = await transaction.ticketComment.create({
      data: {
        ticketId,
        authorUserId: actor.id,
        authorNameSnapshot: actor.fullName,
        visibility: CommentVisibility.PUBLICA,
        body: message,
      },
    });
    await transaction.ticket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.AGUARDANDO_FUNCIONARIO, autoCloseAt: null },
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.MENSAGEM, {
      newValue: comment.id,
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.ALTERACAO_STATUS, {
      previousValue: ticket.status,
      newValue: TicketStatus.AGUARDANDO_FUNCIONARIO,
    });
    await logAdminAction(transaction, actor, 'TICKET_INFORMATION_REQUESTED', 'TICKET', ticketId, {
      from: ticket.status,
      to: TicketStatus.AGUARDANDO_FUNCIONARIO,
      commentId: comment.id,
    });
    return comment;
  });
}

export async function changeTicketStatus(
  database: PrismaClient,
  ticketId: string,
  actor: Actor,
  nextStatus: Extract<TicketStatus, 'EM_TRIAGEM' | 'EM_ATENDIMENTO'>,
) {
  return database.$transaction(async (transaction) => {
    const ticket = await lockAndFindTicket(transaction, ticketId, actor);
    const allowed: Record<string, TicketStatus[]> = {
      [TicketStatus.ABERTO]: [TicketStatus.EM_TRIAGEM, TicketStatus.EM_ATENDIMENTO],
      [TicketStatus.EM_TRIAGEM]: [TicketStatus.EM_ATENDIMENTO],
      [TicketStatus.REABERTO]: [TicketStatus.EM_TRIAGEM, TicketStatus.EM_ATENDIMENTO],
      [TicketStatus.AGUARDANDO_FUNCIONARIO]: [TicketStatus.EM_ATENDIMENTO],
      [TicketStatus.EM_ATENDIMENTO]: [TicketStatus.EM_ATENDIMENTO],
    };
    if (!allowed[ticket.status]?.includes(nextStatus)) {
      throw new HttpError(409, `Transição de ${ticket.status} para ${nextStatus} não permitida.`);
    }
    if (ticket.status === nextStatus) return ticket;
    const updated = await transaction.ticket.update({
      where: { id: ticketId },
      data: { status: nextStatus, autoCloseAt: null },
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.ALTERACAO_STATUS, {
      previousValue: ticket.status,
      newValue: nextStatus,
    });
    await logAdminAction(transaction, actor, 'TICKET_STATUS_CHANGED', 'TICKET', ticketId, {
      from: ticket.status,
      to: nextStatus,
    });
    return updated;
  });
}

export async function resolveTicket(
  database: PrismaClient,
  ticketId: string,
  actor: Actor,
  resolution: string,
) {
  return database.$transaction(async (transaction) => {
    const ticket = await lockAndFindTicket(transaction, ticketId, actor);
    if (
      !([TicketStatus.EM_ATENDIMENTO, TicketStatus.REABERTO] as TicketStatus[]).includes(
        ticket.status,
      )
    ) {
      throw new HttpError(
        409,
        'O chamado precisa estar em atendimento antes de registrar a solução.',
      );
    }
    const resolvedAt = new Date();
    const updated = await transaction.ticket.update({
      where: { id: ticketId },
      data: {
        status: TicketStatus.RESOLVIDO,
        resolution,
        resolvedAt,
        autoCloseAt: null,
      },
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.SOLUCAO, {
      previousValue: ticket.status,
      newValue: TicketStatus.RESOLVIDO,
      reason: resolution,
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.ALTERACAO_STATUS, {
      previousValue: ticket.status,
      newValue: TicketStatus.RESOLVIDO,
    });
    await logAdminAction(transaction, actor, 'TICKET_RESOLVED', 'TICKET', ticketId, {
      from: ticket.status,
      to: TicketStatus.RESOLVIDO,
    });
    return updated;
  });
}

export async function confirmTicketResolution(
  database: PrismaClient,
  ticketId: string,
  actor: Actor,
) {
  return database.$transaction(async (transaction) => {
    const ticket = await lockAndFindTicket(transaction, ticketId, actor);
    if (ticket.status !== TicketStatus.RESOLVIDO) {
      throw new HttpError(409, 'Somente chamados resolvidos podem ser confirmados.');
    }
    const closedAt = new Date();
    const updated = await transaction.ticket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.FECHADO, closedAt, autoCloseAt: null },
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.ENCERRAMENTO, {
      previousValue: TicketStatus.RESOLVIDO,
      newValue: TicketStatus.FECHADO,
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.ALTERACAO_STATUS, {
      previousValue: TicketStatus.RESOLVIDO,
      newValue: TicketStatus.FECHADO,
    });
    return updated;
  });
}

export async function reopenTicket(
  database: PrismaClient,
  ticketId: string,
  actor: Actor,
  reason: string,
) {
  return database.$transaction(async (transaction) => {
    const ticket = await lockAndFindTicket(transaction, ticketId, actor);
    if (ticket.status !== TicketStatus.RESOLVIDO) {
      throw new HttpError(
        409,
        'Somente chamados resolvidos podem receber solicitação de reabertura.',
      );
    }
    const updated = await transaction.ticket.update({
      where: { id: ticketId },
      data: {
        status: TicketStatus.REABERTO,
        resolution: null,
        resolvedAt: null,
        autoCloseAt: null,
      },
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.REABERTURA, {
      previousValue: TicketStatus.RESOLVIDO,
      newValue: TicketStatus.REABERTO,
      reason,
    });
    await addHistory(transaction, ticketId, actor, TicketEventType.ALTERACAO_STATUS, {
      previousValue: TicketStatus.RESOLVIDO,
      newValue: TicketStatus.REABERTO,
    });
    return updated;
  });
}

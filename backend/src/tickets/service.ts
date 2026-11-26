import {
  TicketEventType,
  TicketStatus,
  UserRole,
  type Prisma,
} from '../generated/prisma/client.ts';
import { HttpError } from '../http/errors.js';
import type { CreateTicketInput } from './validation.js';
import { nextTicketProtocol, saoPauloCalendarYear } from './protocol.js';

export async function createTicketInTransaction(
  transaction: Prisma.TransactionClient,
  requesterUserId: string,
  input: CreateTicketInput,
  createdAt: Date,
) {
  const lockedUsers = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM users WHERE id = ${requesterUserId} FOR SHARE
  `;
  if (lockedUsers.length === 0) throw new HttpError(403, 'A conta não pode abrir chamados.');

  const requester = await transaction.user.findUnique({
    where: { id: requesterUserId },
    include: { unit: true, department: true },
  });
  if (
    !requester ||
    !requester.isActive ||
    !requester.emailVerifiedAt ||
    requester.role !== UserRole.FUNCIONARIO
  ) {
    throw new HttpError(403, 'A conta não pode abrir chamados.');
  }
  if (
    !requester.unit.isActive ||
    !requester.department.isActive ||
    requester.department.unitId !== requester.unitId
  ) {
    throw new HttpError(409, 'A unidade ou o setor do perfil está indisponível.');
  }

  const activeLocations = await transaction.$queryRaw<
    Array<{ unitId: string; departmentId: string }>
  >`
    SELECT u.id AS unitId, d.id AS departmentId
    FROM units AS u
    INNER JOIN departments AS d ON d.unitId = u.id
    WHERE u.id = ${requester.unitId}
      AND u.isActive = TRUE
      AND d.id = ${requester.departmentId}
      AND d.isActive = TRUE
    FOR SHARE
  `;
  if (activeLocations.length === 0) {
    throw new HttpError(409, 'A unidade ou o setor do perfil está indisponível.');
  }

  const categories = await transaction.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT id, name FROM ticket_categories
    WHERE id = ${input.categoryId} AND isActive = TRUE
    FOR SHARE
  `;
  const category = categories[0];
  if (!category) throw new HttpError(400, 'Selecione uma categoria ativa.');

  const year = saoPauloCalendarYear(createdAt);
  const number = await nextTicketProtocol(transaction, year);
  const ticket = await transaction.ticket.create({
    data: {
      number,
      title: input.title,
      description: input.description,
      status: TicketStatus.ABERTO,
      priority: input.priority,
      suggestedPriority: input.priority,
      requesterUserId: requester.id,
      requesterNameSnapshot: requester.fullName,
      requesterEmailSnapshot: requester.email,
      departmentId: requester.department.id,
      departmentNameSnapshot: requester.department.name,
      unitId: requester.unit.id,
      unitNameSnapshot: requester.unit.name,
      categoryId: category.id,
      categoryNameSnapshot: category.name,
      createdAt,
    },
  });

  await transaction.ticketHistory.create({
    data: {
      ticketId: ticket.id,
      actorUserId: requester.id,
      actorNameSnapshot: requester.fullName,
      eventType: TicketEventType.ABERTURA,
      newValue: TicketStatus.ABERTO,
      createdAt,
    },
  });

  return ticket;
}

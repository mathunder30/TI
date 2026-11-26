import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TicketEventType,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '../generated/prisma/client.ts';
import {
  encryptEphemeralSecret,
  hashSecret,
  createOpaqueToken,
  SESSION_COOKIE,
} from '../auth/crypto.js';
import { prisma } from '../db/prisma.js';
import { errorHandler } from '../http/errors.js';
import { createTicketsRouter } from './router.js';
import { createTicketInTransaction } from './service.js';
import { env } from '../config/env.js';

const runIntegrationRequested = process.env.RUN_MYSQL_INTEGRATION === '1';
const localDatabaseHost = ['127.0.0.1', 'localhost'].includes(new URL(env.DATABASE_URL).hostname);
if (runIntegrationRequested && (env.NODE_ENV === 'production' || !localDatabaseHost)) {
  throw new Error(
    'Os testes MySQL só podem ser executados contra um banco local que não seja produção.',
  );
}
const integration = runIntegrationRequested ? describe : describe.skip;
const protocolInstant = new Date('2099-01-01T02:30:00.000Z'); // 2098-12-31 23:30 in Brasília
const protocolYear = 2098;
const suffix = `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 18);
const testApp = express();
testApp.use(express.json());
testApp.use(
  '/api/v1/tickets',
  createTicketsRouter({ database: prisma, now: () => new Date(protocolInstant) }),
);
testApp.use(errorHandler);

type SessionCookie = { cookie: string; csrf: string };
const sessions = new Map<string, SessionCookie>();
const userIds: string[] = [];
let unitAId = '';
let unitBId = '';
let departmentAId = '';
let departmentBId = '';
let inactiveDepartmentId = '';
let categoryId = '';
let inactiveCategoryId = '';
let requesterId = '';
let unverifiedId = '';
let invalidProfileId = '';
let inactiveUnitUserId = '';
let inactiveDepartmentUserId = '';
let tiId = '';

async function createUser(input: {
  suffix: string;
  unitId: string;
  departmentId: string;
  role?: UserRole;
  verified?: boolean;
}) {
  const user = await prisma.user.create({
    data: {
      fullName: `Teste ${input.suffix}`,
      email: `${input.suffix.toLowerCase()}@example.invalid`,
      emailVerifiedAt: input.verified === false ? null : new Date(),
      role: input.role ?? UserRole.FUNCIONARIO,
      tiSlot: null,
      unitId: input.unitId,
      departmentId: input.departmentId,
    },
  });
  userIds.push(user.id);
  const rawSession = createOpaqueToken();
  const rawCsrf = createOpaqueToken();
  await prisma.authSession.create({
    data: {
      userId: user.id,
      tokenHash: hashSecret(rawSession),
      csrfTokenHash: hashSecret(rawCsrf),
      csrfTokenEncrypted: encryptEphemeralSecret(rawCsrf),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  sessions.set(user.id, { cookie: `${SESSION_COOKIE}=${rawSession}`, csrf: rawCsrf });
  return user;
}

function openTicket(userId: string, body: Record<string, unknown>) {
  const session = sessions.get(userId)!;
  return request(testApp)
    .post('/api/v1/tickets')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session.cookie)
    .set('x-csrf-token', session.csrf)
    .send(body);
}

async function cleanTestTickets() {
  if (userIds.length > 0) {
    const tickets = await prisma.ticket.findMany({
      where: { requesterUserId: { in: userIds } },
      select: { id: true },
    });
    const ticketIds = tickets.map((ticket) => ticket.id);
    if (ticketIds.length > 0) {
      await prisma.ticketHistory.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    }
  }
  await prisma.ticketProtocolCounter.deleteMany({ where: { year: protocolYear } });
}

integration('abertura de chamados no MySQL', () => {
  beforeAll(async () => {
    const unitA = await prisma.unit.create({
      data: { code: `T${suffix}A`, name: `Teste unidade A ${suffix}` },
    });
    const unitB = await prisma.unit.create({
      data: { code: `T${suffix}B`, name: `Teste unidade B ${suffix}` },
    });
    unitAId = unitA.id;
    unitBId = unitB.id;
    const departmentA = await prisma.department.create({
      data: { code: `T${suffix}A`, name: `Teste setor A ${suffix}`, unitId: unitA.id },
    });
    const departmentB = await prisma.department.create({
      data: { code: `T${suffix}B`, name: `Teste setor B ${suffix}`, unitId: unitB.id },
    });
    departmentAId = departmentA.id;
    departmentBId = departmentB.id;
    const inactiveDepartment = await prisma.department.create({
      data: { code: `T${suffix}C`, name: `Teste setor inativo ${suffix}`, unitId: unitA.id },
    });
    inactiveDepartmentId = inactiveDepartment.id;
    const category = await prisma.ticketCategory.create({
      data: { code: `T${suffix}`, name: `Teste categoria ${suffix}` },
    });
    const inactiveCategory = await prisma.ticketCategory.create({
      data: { code: `I${suffix}`, name: `Teste categoria inativa ${suffix}`, isActive: false },
    });
    categoryId = category.id;
    inactiveCategoryId = inactiveCategory.id;

    const requester = await createUser({
      suffix: `R${suffix}`,
      unitId: unitA.id,
      departmentId: departmentA.id,
    });
    const unverified = await createUser({
      suffix: `V${suffix}`,
      unitId: unitA.id,
      departmentId: departmentA.id,
      verified: false,
    });
    const invalidProfile = await createUser({
      suffix: `M${suffix}`,
      unitId: unitA.id,
      departmentId: departmentB.id,
    });
    const inactiveUnitUser = await createUser({
      suffix: `X${suffix}`,
      unitId: unitB.id,
      departmentId: departmentB.id,
    });
    const inactiveDepartmentUser = await createUser({
      suffix: `Y${suffix}`,
      unitId: unitA.id,
      departmentId: inactiveDepartment.id,
    });
    await prisma.unit.update({ where: { id: unitB.id }, data: { isActive: false } });
    await prisma.department.update({
      where: { id: inactiveDepartment.id },
      data: { isActive: false },
    });
    const ti = await createUser({
      suffix: `T${suffix}`,
      unitId: unitA.id,
      departmentId: departmentA.id,
      role: UserRole.TI,
    });
    requesterId = requester.id;
    unverifiedId = unverified.id;
    invalidProfileId = invalidProfile.id;
    inactiveUnitUserId = inactiveUnitUser.id;
    inactiveDepartmentUserId = inactiveDepartmentUser.id;
    tiId = ti.id;
  });

  beforeEach(cleanTestTickets);

  afterAll(async () => {
    try {
      await cleanTestTickets();
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (categoryId || inactiveCategoryId) {
        await prisma.ticketCategory.deleteMany({
          where: { id: { in: [categoryId, inactiveCategoryId].filter(Boolean) } },
        });
      }
      if (departmentAId || departmentBId) {
        await prisma.department.deleteMany({
          where: {
            id: { in: [departmentAId, departmentBId, inactiveDepartmentId].filter(Boolean) },
          },
        });
      }
      if (unitAId || unitBId) {
        await prisma.unit.deleteMany({ where: { id: { in: [unitAId, unitBId].filter(Boolean) } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('abre um chamado autenticado e persiste snapshots, prioridade e evento inicial', async () => {
    const response = await openTicket(requesterId, {
      title: 'Computador não inicia',
      description: 'O equipamento permanece desligado mesmo conectado à energia.',
      categoryId,
      priority: TicketPriority.ALTA,
    });

    expect(response.status).toBe(201);
    expect(response.body.ticket.number).toBe('SC-2098-00001');
    expect(response.body.ticket.status).toBe(TicketStatus.ABERTO);
    expect(response.body.ticket.priority).toBe(TicketPriority.ALTA);
    expect(response.body.ticket.suggestedPriority).toBe(TicketPriority.ALTA);
    expect(response.body.ticket.requesterUserId).toBe(requesterId);
    expect(response.body.ticket.requesterNameSnapshot).toBe(`Teste R${suffix}`);
    expect(response.body.ticket.requesterEmailSnapshot).toBe(
      `r${suffix.toLowerCase()}@example.invalid`,
    );
    expect(response.body.ticket.unitNameSnapshot).toBe(`Teste unidade A ${suffix}`);
    expect(response.body.ticket.departmentNameSnapshot).toBe(`Teste setor A ${suffix}`);
    expect(response.body.ticket.categoryNameSnapshot).toBe(`Teste categoria ${suffix}`);

    const history = await prisma.ticketHistory.findMany({
      where: { ticketId: response.body.ticket.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actorUserId: requesterId,
      actorNameSnapshot: `Teste R${suffix}`,
      eventType: TicketEventType.ABERTURA,
      newValue: TicketStatus.ABERTO,
    });
  });

  it('rejeita título/descrição inválidos e campos de identidade enviados pelo frontend', async () => {
    const invalidBodies = [
      {
        title: 'Oi',
        description: 'Descrição longa o bastante para validar.',
        categoryId,
        priority: 'MEDIA',
      },
      { title: 'Título válido', description: 'curto', categoryId, priority: 'MEDIA' },
      {
        title: 'Título válido',
        description: 'Descrição longa o bastante para validar.',
        categoryId,
        priority: 'URGENTE',
      },
      {
        title: 'Título válido',
        description: 'Descrição longa o bastante para validar.',
        categoryId,
        priority: 'MEDIA',
        requesterUserId: 'id-forjado',
        role: 'TI',
        fullName: 'Nome forjado',
        email: 'forjado@example.invalid',
        unitId: unitBId,
        departmentId: departmentBId,
      },
    ];

    for (const body of invalidBodies) {
      expect((await openTicket(requesterId, body)).status).toBe(400);
    }
    expect(await prisma.ticket.count({ where: { requesterUserId: requesterId } })).toBe(0);
  });

  it('rejeita categoria inativa, perfil sem validação e unidade/setor incompatíveis', async () => {
    const validBody = {
      title: 'Falha no sistema',
      description: 'A aplicação fecha ao abrir o menu principal.',
      categoryId,
      priority: 'MEDIA',
    };
    expect(
      (await openTicket(requesterId, { ...validBody, categoryId: inactiveCategoryId })).status,
    ).toBe(400);
    expect((await openTicket(unverifiedId, validBody)).status).toBe(403);
    expect((await openTicket(invalidProfileId, validBody)).status).toBe(409);
    expect((await openTicket(inactiveUnitUserId, validBody)).status).toBe(409);
    expect((await openTicket(inactiveDepartmentUserId, validBody)).status).toBe(409);
    expect((await openTicket(tiId, validBody)).status).toBe(403);
    expect(await prisma.ticket.count({ where: { requesterUserId: { in: userIds } } })).toBe(0);
  });

  it('gera protocolos distintos para aberturas simultâneas no mesmo ano', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        openTicket(requesterId, {
          title: 'Solicitação simultânea',
          description: 'Descrição de teste para concorrência de protocolos.',
          categoryId,
          priority: 'BAIXA',
        }),
      ),
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
    const numbers = responses.map((response) => response.body.ticket.number).sort();
    expect(new Set(numbers).size).toBe(20);
    expect(numbers).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `SC-2098-${String(index + 1).padStart(5, '0')}`,
      ).sort(),
    );
    expect(await prisma.ticket.count({ where: { requesterUserId: requesterId } })).toBe(20);
  });

  it('faz rollback de chamado, evento e contador se a transação falhar', async () => {
    const input = {
      title: 'Falha simulada',
      description: 'Forçar rollback depois da criação completa.',
      categoryId,
      priority: TicketPriority.MEDIA,
    };

    await expect(
      prisma.$transaction(async (transaction) => {
        await createTicketInTransaction(transaction, requesterId, input, protocolInstant);
        throw new Error('SIMULATED_ROLLBACK');
      }),
    ).rejects.toThrow('SIMULATED_ROLLBACK');

    expect(await prisma.ticket.count({ where: { requesterUserId: requesterId } })).toBe(0);
    expect(await prisma.ticketHistory.count({ where: { actorUserId: requesterId } })).toBe(0);
    expect(
      await prisma.ticketProtocolCounter.findUnique({ where: { year: protocolYear } }),
    ).toBeNull();
  });
});

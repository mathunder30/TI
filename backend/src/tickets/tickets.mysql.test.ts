import express from 'express';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
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
import { attachmentStorageDirectory } from './attachments.js';

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
const sessionIds: string[] = [];
let unitAId = '';
let unitBId = '';
let departmentAId = '';
let departmentBId = '';
let inactiveDepartmentId = '';
let categoryId = '';
let inactiveCategoryId = '';
let requesterId = '';
let otherRequesterId = '';
let unverifiedId = '';
let invalidProfileId = '';
let inactiveUnitUserId = '';
let inactiveDepartmentUserId = '';
let tiId = '';
let unprovisionedTiId = '';
let ownsAdminSlot = false;

async function createSession(userId: string) {
  const rawSession = createOpaqueToken();
  const rawCsrf = createOpaqueToken();
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashSecret(rawSession),
      csrfTokenHash: hashSecret(rawCsrf),
      csrfTokenEncrypted: encryptEphemeralSecret(rawCsrf),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  sessionIds.push(session.id);
  sessions.set(userId, { cookie: `${SESSION_COOKIE}=${rawSession}`, csrf: rawCsrf });
}

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
  await createSession(user.id);
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

function getTickets(userId: string, path: string) {
  return request(testApp).get(`/api/v1/tickets${path}`).set('Cookie', sessions.get(userId)!.cookie);
}

function mutateTicket(
  userId: string,
  method: 'post' | 'patch' | 'delete',
  path: string,
  body: Record<string, unknown> = {},
) {
  const session = sessions.get(userId)!;
  const agent = request(testApp);
  return agent[method](`/api/v1/tickets${path}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session.cookie)
    .set('x-csrf-token', session.csrf)
    .send(body);
}

function attachFile(
  userId: string,
  ticketId: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
) {
  const session = sessions.get(userId)!;
  return request(testApp)
    .post(`/api/v1/tickets/${ticketId}/attachments`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session.cookie)
    .set('x-csrf-token', session.csrf)
    .attach('file', bytes, { filename, contentType });
}

async function cleanTestTickets() {
  if (userIds.length > 0) {
    const tickets = await prisma.ticket.findMany({
      where: { requesterUserId: { in: userIds } },
      select: { id: true },
    });
    const ticketIds = tickets.map((ticket) => ticket.id);
    if (ticketIds.length > 0) {
      const attachments = await prisma.ticketAttachment.findMany({
        where: { ticketId: { in: ticketIds } },
        select: { id: true, storageKey: true },
      });
      const comments = await prisma.ticketComment.findMany({
        where: { ticketId: { in: ticketIds } },
        select: { id: true },
      });
      await Promise.all(
        attachments.map(({ storageKey }) =>
          rm(resolve(attachmentStorageDirectory, storageKey), { force: true }),
        ),
      );
      await prisma.auditLog.deleteMany({
        where: {
          entityId: {
            in: [...ticketIds, ...attachments.map(({ id }) => id), ...comments.map(({ id }) => id)],
          },
          action: { startsWith: 'TICKET_' },
        },
      });
      await prisma.ticketAttachment.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await prisma.ticketComment.deleteMany({ where: { ticketId: { in: ticketIds } } });
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
    const otherRequester = await createUser({
      suffix: `O${suffix}`,
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
    requesterId = requester.id;
    otherRequesterId = otherRequester.id;
    unverifiedId = unverified.id;
    invalidProfileId = invalidProfile.id;
    inactiveUnitUserId = inactiveUnitUser.id;
    inactiveDepartmentUserId = inactiveDepartmentUser.id;
    const administrator = await prisma.adminAccount.findUnique({
      where: { slot: 1 },
      select: { userId: true },
    });
    if (administrator) {
      tiId = administrator.userId;
      await createSession(tiId);
    } else {
      const ti = await createUser({
        suffix: `T${suffix}`,
        unitId: unitA.id,
        departmentId: departmentA.id,
        role: UserRole.TI,
      });
      tiId = ti.id;
      await prisma.adminAccount.create({ data: { slot: 1, userId: ti.id } });
      ownsAdminSlot = true;
    }
    const unprovisionedTi = await createUser({
      suffix: `U${suffix}`,
      unitId: unitA.id,
      departmentId: departmentA.id,
      role: UserRole.TI,
    });
    unprovisionedTiId = unprovisionedTi.id;
  });

  beforeEach(cleanTestTickets);

  afterAll(async () => {
    try {
      await cleanTestTickets();
      await prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } });
      if (ownsAdminSlot) await prisma.adminAccount.deleteMany({ where: { slot: 1, userId: tiId } });
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

  it('permite mensagens públicas somente aos participantes e mantém comentário e histórico juntos', async () => {
    const opened = await openTicket(requesterId, {
      title: 'Mensagens da solicitação',
      description: 'Teste a conversa pública entre funcionário e TI neste chamado.',
      categoryId,
      priority: 'MEDIA',
    });
    const ticketId = opened.body.ticket.id as string;
    const employeeMessage = await mutateTicket(requesterId, 'post', `/${ticketId}/messages`, {
      body: 'Segue mais contexto para o atendimento.',
    });
    expect(employeeMessage.status).toBe(201);
    const tiMessage = await mutateTicket(tiId, 'post', `/${ticketId}/messages`, {
      body: 'Recebemos os detalhes e estamos verificando.',
    });
    expect(tiMessage.status).toBe(201);
    expect(
      (
        await mutateTicket(otherRequesterId, 'post', `/${ticketId}/messages`, {
          body: 'Tentativa de terceiro.',
        })
      ).status,
    ).toBe(404);
    expect((await getTickets(otherRequesterId, `/${ticketId}/messages`)).status).toBe(404);
    expect(
      (
        await mutateTicket(
          requesterId,
          'delete',
          `/${ticketId}/messages/${employeeMessage.body.message.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mutateTicket(
          requesterId,
          'patch',
          `/${ticketId}/messages/${employeeMessage.body.message.id}`,
          { body: 'edição' },
        )
      ).status,
    ).toBe(404);

    const messages = await getTickets(requesterId, `/${ticketId}/messages`);
    expect(messages.status).toBe(200);
    expect(messages.body.messages.map((item: { body: string }) => item.body)).toEqual([
      'Segue mais contexto para o atendimento.',
      'Recebemos os detalhes e estamos verificando.',
    ]);
    const commentCount = await prisma.ticketComment.count({ where: { ticketId } });
    const messageHistory = await prisma.ticketHistory.count({
      where: { ticketId, eventType: TicketEventType.MENSAGEM },
    });
    expect(commentCount).toBe(2);
    expect(messageHistory).toBe(2);
    await prisma.ticketComment.create({
      data: {
        ticketId,
        authorUserId: tiId,
        authorNameSnapshot: 'TI interno',
        visibility: 'INTERNA',
        body: 'SEGREDO_NOTA_INTERNA',
      },
    });
    const publicOnly = await getTickets(requesterId, `/${ticketId}/messages`);
    expect(publicOnly.body.messages).toHaveLength(2);
    expect(JSON.stringify(publicOnly.body)).not.toContain('SEGREDO_NOTA_INTERNA');
    expect(
      await prisma.auditLog.count({
        where: { entityId: tiMessage.body.message.id, action: 'TICKET_PUBLIC_MESSAGE_CREATED' },
      }),
    ).toBe(1);
  });

  it('valida transições, solicitação de informação, solução, confirmação e reabertura com motivo', async () => {
    const opened = await openTicket(requesterId, {
      title: 'Transições do chamado',
      description: 'Validar as transições operacionais definidas para o fluxo de atendimento.',
      categoryId,
      priority: 'ALTA',
    });
    const ticketId = opened.body.ticket.id as string;
    expect(
      (await mutateTicket(requesterId, 'patch', `/${ticketId}/status`, { status: 'EM_TRIAGEM' }))
        .status,
    ).toBe(403);
    expect(
      (
        await mutateTicket(tiId, 'post', `/${ticketId}/resolve`, {
          resolution: 'resolução prematura',
        })
      ).status,
    ).toBe(409);
    const triage = await mutateTicket(tiId, 'patch', `/${ticketId}/status`, {
      status: 'EM_TRIAGEM',
    });
    expect(triage.status).toBe(200);
    expect(triage.body.ticket.status).toBe(TicketStatus.EM_TRIAGEM);
    expect(
      (await mutateTicket(tiId, 'patch', `/${ticketId}/status`, { status: 'FECHADO' })).status,
    ).toBe(400);
    const requestInfo = await mutateTicket(tiId, 'post', `/${ticketId}/request-information`, {
      body: 'Por favor, informe em qual horário o erro costuma acontecer.',
    });
    expect(requestInfo.status).toBe(201);
    expect(requestInfo.body.status).toBe(TicketStatus.AGUARDANDO_FUNCIONARIO);
    expect((await prisma.ticket.findUnique({ where: { id: ticketId } }))?.status).toBe(
      TicketStatus.AGUARDANDO_FUNCIONARIO,
    );
    expect(
      (
        await mutateTicket(requesterId, 'post', `/${ticketId}/messages`, {
          body: 'O erro acontece ao iniciar o computador.',
        })
      ).status,
    ).toBe(201);
    expect((await prisma.ticket.findUnique({ where: { id: ticketId } }))?.status).toBe(
      TicketStatus.EM_ATENDIMENTO,
    );
    expect(
      (await mutateTicket(tiId, 'post', `/${ticketId}/resolve`, { resolution: 'curta' })).status,
    ).toBe(400);
    const resolved = await mutateTicket(tiId, 'post', `/${ticketId}/resolve`, {
      resolution: 'Driver de rede atualizado e conexão validada com sucesso.',
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.ticket.status).toBe(TicketStatus.RESOLVIDO);
    expect(
      (await mutateTicket(requesterId, 'post', `/${ticketId}/reopen`, { reason: 'curto' })).status,
    ).toBe(400);
    const reopened = await mutateTicket(requesterId, 'post', `/${ticketId}/reopen`, {
      reason: 'A falha retornou após reiniciar o computador.',
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.ticket.status).toBe(TicketStatus.REABERTO);
    const secondResolution = await mutateTicket(tiId, 'post', `/${ticketId}/resolve`, {
      resolution: 'Configuração corrigida e novo teste de conexão concluído.',
    });
    expect(secondResolution.status).toBe(200);
    const confirmation = await mutateTicket(
      requesterId,
      'post',
      `/${ticketId}/confirm-resolution`,
      {},
    );
    expect(confirmation.status).toBe(200);
    expect(confirmation.body.ticket.status).toBe(TicketStatus.FECHADO);
    expect(
      (
        await mutateTicket(requesterId, 'post', `/${ticketId}/messages`, {
          body: 'mensagem após fechar',
        })
      ).status,
    ).toBe(409);

    const events = await prisma.ticketHistory.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      select: { eventType: true, previousValue: true, newValue: true, reason: true },
    });
    expect(
      events.some(
        (event) =>
          event.eventType === TicketEventType.SOLUCAO && event.reason?.includes('Driver de rede'),
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.eventType === TicketEventType.REABERTURA &&
          event.reason?.includes('A falha retornou'),
      ),
    ).toBe(true);
    expect(
      events.filter((event) => event.eventType === TicketEventType.ALTERACAO_STATUS).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('restringe a fila TI à conta singleton e mostra os chamados de todas as pessoas ao TI', async () => {
    await openTicket(requesterId, {
      title: 'Chamado na fila TI',
      description: 'Este chamado precisa aparecer na fila do administrador.',
      categoryId,
      priority: 'MEDIA',
    });
    await openTicket(otherRequesterId, {
      title: 'Outro chamado na fila',
      description: 'Também pertence ao conjunto global de chamados.',
      categoryId,
      priority: 'BAIXA',
    });
    expect((await getTickets(requesterId, '/ti')).status).toBe(403);
    expect((await getTickets(unprovisionedTiId, '/ti')).status).toBe(403);
    expect((await getTickets(unprovisionedTiId, '/not-a-real-ticket')).status).toBe(403);
    const queue = await getTickets(tiId, '/ti?pageSize=50');
    expect(queue.status).toBe(200);
    expect(queue.body.items).toHaveLength(2);
    expect(queue.body.items.map((item: { requester: string }) => item.requester)).toContain(
      `Teste R${suffix}`,
    );
  });

  it('valida assinatura real, tipo declarado, limites e autorização dos anexos privados', async () => {
    const own = await openTicket(requesterId, {
      title: 'Anexos do chamado',
      description: 'Validar upload, acesso privado e integridade dos anexos enviados.',
      categoryId,
      priority: 'MEDIA',
    });
    const foreign = await openTicket(otherRequesterId, {
      title: 'Anexo de terceiro',
      description: 'Este anexo não pode ser consultado por outras contas.',
      categoryId,
      priority: 'MEDIA',
    });
    const ticketId = own.body.ticket.id as string;
    const validFormats = await openTicket(requesterId, {
      title: 'Formatos de anexos',
      description: 'Testar as assinaturas reais de JPG, JPEG, PNG e PDF aceitas pela API.',
      categoryId,
      priority: 'BAIXA',
    });
    const formatTicketId = validFormats.body.ticket.id as string;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3xkAAAAASUVORK5CYII=',
      'base64',
    );
    const uploaded = await attachFile(requesterId, ticketId, png, 'evidencia.png', 'image/png');
    expect(uploaded.status).toBe(201);
    const attachmentId = uploaded.body.attachment.id as string;
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
    expect(
      (await attachFile(requesterId, formatTicketId, jpeg, 'foto.jpg', 'image/jpeg')).status,
    ).toBe(201);
    expect(
      (await attachFile(requesterId, formatTicketId, jpeg, 'foto.jpeg', 'image/jpeg')).status,
    ).toBe(201);
    expect(
      (await attachFile(requesterId, formatTicketId, pdf, 'documento.pdf', 'application/pdf'))
        .status,
    ).toBe(201);
    const downloaded = await getTickets(requesterId, `/${ticketId}/attachments/${attachmentId}`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toContain('image/png');
    expect(Buffer.compare(downloaded.body as Buffer, png)).toBe(0);
    expect(
      (await getTickets(otherRequesterId, `/${ticketId}/attachments/${attachmentId}`)).status,
    ).toBe(404);
    expect(
      (await getTickets(requesterId, `/${foreign.body.ticket.id}/attachments/${attachmentId}`))
        .status,
    ).toBe(404);

    const spoofed = await attachFile(
      requesterId,
      ticketId,
      Buffer.from('%PDF-1.7\nconteúdo'),
      'fraude.png',
      'image/png',
    );
    expect(spoofed.status).toBe(400);
    const mismatchedMime = await attachFile(
      requesterId,
      ticketId,
      Buffer.from('%PDF-1.7\nconteúdo'),
      'documento.pdf',
      'image/png',
    );
    expect(mismatchedMime.status).toBe(400);
    const tooLarge = await attachFile(
      requesterId,
      ticketId,
      Buffer.alloc(env.ATTACHMENT_MAX_SIZE_BYTES + 1, 0),
      'grande.pdf',
      'application/pdf',
    );
    expect(tooLarge.status).toBe(413);

    for (let index = 1; index < env.ATTACHMENT_MAX_PER_TICKET; index += 1) {
      expect(
        (await attachFile(requesterId, ticketId, png, `evidencia-${index}.png`, 'image/png'))
          .status,
      ).toBe(201);
    }
    expect((await attachFile(requesterId, ticketId, png, 'limite.png', 'image/png')).status).toBe(
      409,
    );
    expect(
      await prisma.ticketHistory.count({ where: { ticketId, eventType: TicketEventType.ANEXO } }),
    ).toBe(env.ATTACHMENT_MAX_PER_TICKET);
  });

  it('lista somente os chamados do funcionário autenticado e retorna DTO público', async () => {
    const own = await openTicket(requesterId, {
      title: 'Impressora do setor',
      description: 'A impressora não aparece na lista de dispositivos.',
      categoryId,
      priority: 'ALTA',
    });
    await openTicket(otherRequesterId, {
      title: 'Chamado de outra pessoa',
      description: 'Este conteúdo pertence a outro funcionário.',
      categoryId,
      priority: 'BAIXA',
    });
    const response = await getTickets(requesterId, '');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      id: own.body.ticket.id,
      number: 'SC-2098-00001',
      title: 'Impressora do setor',
      category: `Teste categoria ${suffix}`,
      priority: 'ALTA',
      status: 'ABERTO',
    });
    expect(response.body.items[0]).not.toHaveProperty('requesterUserId');
    expect(response.body.items[0]).not.toHaveProperty('description');
    expect(response.body.items[0]).not.toHaveProperty('history');
  });

  it('filtra por status, prioridade, categoria e pesquisa; paginação limita tamanho', async () => {
    await openTicket(requesterId, {
      title: 'Notebook para recepção',
      description: 'O notebook da recepção está sem conexão de rede.',
      categoryId,
      priority: 'ALTA',
    });
    await openTicket(requesterId, {
      title: 'Acesso ao sistema',
      description: 'Não consigo entrar no sistema financeiro.',
      categoryId,
      priority: 'BAIXA',
    });
    const filtered = await getTickets(
      requesterId,
      `?status=ABERTO&priority=ALTA&categoryId=${categoryId}&q=recepção&page=1&pageSize=1`,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].title).toBe('Notebook para recepção');
    expect(filtered.body.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      totalItems: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    });
    expect((await getTickets(requesterId, '?pageSize=51')).status).toBe(400);
    expect((await getTickets(requesterId, '?page=0')).status).toBe(400);
  });

  it('oculta chamado de outro funcionário com 404 e expõe apenas timeline pública', async () => {
    const own = await openTicket(requesterId, {
      title: 'Acesso ao Wi-Fi',
      description: 'O acesso à rede sem fio não autentica neste equipamento.',
      categoryId,
      priority: 'MEDIA',
    });
    const foreign = await openTicket(otherRequesterId, {
      title: 'Chamado privado',
      description: 'Dados exclusivos de outro funcionário.',
      categoryId,
      priority: 'MEDIA',
    });
    expect((await getTickets(requesterId, `/${foreign.body.ticket.id}`)).status).toBe(404);
    expect((await getTickets(requesterId, `/${foreign.body.ticket.id}/timeline`)).status).toBe(404);

    await prisma.ticketHistory.create({
      data: {
        ticketId: own.body.ticket.id,
        actorUserId: tiId,
        actorNameSnapshot: `Administrador secreto ${suffix}`,
        eventType: TicketEventType.NOTA_INTERNA,
        reason: `INTERNAL_SECRET_${suffix}`,
        metadata: { private: `PRIVATE_METADATA_${suffix}` },
      },
    });
    const detail = await getTickets(requesterId, `/${own.body.ticket.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.ticket).toMatchObject({
      requester: { name: `Teste R${suffix}` },
      unit: `Teste unidade A ${suffix}`,
      department: `Teste setor A ${suffix}`,
      category: `Teste categoria ${suffix}`,
    });
    expect(detail.body.ticket).not.toHaveProperty('requesterUserId');
    expect(detail.body.ticket).not.toHaveProperty('internalResolution');
    expect(detail.body.ticket).not.toHaveProperty('history');

    const timeline = await getTickets(requesterId, `/${own.body.ticket.id}/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.timeline).toHaveLength(1);
    expect(timeline.body.timeline[0]).toMatchObject({ label: 'Chamado aberto', to: 'Aberto' });
    expect(JSON.stringify(timeline.body)).not.toContain(`INTERNAL_SECRET_${suffix}`);
    expect(JSON.stringify(timeline.body)).not.toContain(`PRIVATE_METADATA_${suffix}`);
    expect(JSON.stringify(timeline.body)).not.toContain(`Administrador secreto ${suffix}`);
    expect(timeline.body.timeline[0]).not.toHaveProperty('metadata');
    expect(timeline.body.timeline[0]).not.toHaveProperty('reason');
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

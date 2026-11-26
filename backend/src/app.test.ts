import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('./db/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  },
}));

const { app } = await import('./app.js');

afterEach(() => vi.clearAllMocks());

describe('API foundation', () => {
  it('reports the process liveness without database access', async () => {
    const response = await request(app).get('/api/v1/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'portal-chamados-api' });
  });

  it('rejects unknown routes with a standard JSON error', async () => {
    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe('Rota não encontrada.');
  });

  it('checks readiness against MySQL', async () => {
    const response = await request(app).get('/api/v1/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', dependencies: { mysql: 'ok' } });
  });
});

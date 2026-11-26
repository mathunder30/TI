import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.ts';
import { initialTicketCategories, seedTicketCategories } from './seed-ticket-categories.js';

describe('seed de categorias de chamados', () => {
  it('insere nove categorias uma vez e mantém o resultado nas execuções seguintes', async () => {
    const records = new Map<string, { id: string; code: string; name: string }>();
    const findUnique = vi.fn(async ({ where }: { where: { code?: string; name?: string } }) => {
      return (
        [...records.values()].find(
          (record) => record.code === where.code || record.name === where.name,
        ) ?? null
      );
    });
    const create = vi.fn(async ({ data }: { data: { code: string; name: string } }) => {
      const record = { ...data, id: `id-${data.code}` };
      records.set(data.code, record);
      return record;
    });
    const transaction = {
      ticketCategory: { findUnique, create },
    } as unknown as Prisma.TransactionClient;

    expect(await seedTicketCategories(transaction)).toBe(9);
    expect(await seedTicketCategories(transaction)).toBe(0);
    expect(records.size).toBe(9);
    expect(create).toHaveBeenCalledTimes(9);
    expect(initialTicketCategories).toHaveLength(9);
  });
});

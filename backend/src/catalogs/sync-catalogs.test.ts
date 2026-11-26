import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.ts';
import { catalogFileSchema } from './catalog-schema.js';
import { syncCatalogs } from './sync-catalogs.js';

describe('sincronização idempotente de unidades e setores', () => {
  it('carrega várias unidades/setores e não duplica registros ao repetir o arquivo', async () => {
    const units = new Map<string, { id: string; code: string; name: string; isActive: boolean }>();
    const departments = new Map<
      string,
      { id: string; unitId: string; code: string; name: string; isActive: boolean }
    >();
    const unitCreate = vi.fn(
      async ({ data }: { data: { code: string; name: string; isActive?: boolean } }) => {
        const unit = { id: `unit-${data.code}`, ...data, isActive: data.isActive ?? true };
        units.set(data.code, unit);
        return unit;
      },
    );
    const unitUpdate = vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { name?: string; isActive?: boolean };
      }) => {
        const unit = [...units.values()].find((candidate) => candidate.id === where.id)!;
        const updated = { ...unit, ...data };
        units.set(updated.code, updated);
        return updated;
      },
    );
    const departmentCreate = vi.fn(
      async ({
        data,
      }: {
        data: { unitId: string; code: string; name: string; isActive?: boolean };
      }) => {
        const department = {
          id: `${data.unitId}-${data.code}`,
          ...data,
          isActive: data.isActive ?? true,
        };
        departments.set(`${data.unitId}:${data.code}`, department);
        return department;
      },
    );
    const departmentUpdate = vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { name?: string; isActive?: boolean };
      }) => {
        const department = [...departments.values()].find(
          (candidate) => candidate.id === where.id,
        )!;
        const updated = { ...department, ...data };
        departments.set(`${updated.unitId}:${updated.code}`, updated);
        return updated;
      },
    );
    const transaction = {
      unit: {
        findUnique: vi.fn(
          async ({ where }: { where: { code: string } }) => units.get(where.code) ?? null,
        ),
        create: unitCreate,
        update: unitUpdate,
      },
      department: {
        findUnique: vi.fn(
          async ({ where }: { where: { unitId_code: { unitId: string; code: string } } }) =>
            departments.get(`${where.unitId_code.unitId}:${where.unitId_code.code}`) ?? null,
        ),
        create: departmentCreate,
        update: departmentUpdate,
      },
    } as unknown as Prisma.TransactionClient;
    const catalogs = catalogFileSchema.parse({
      version: 1,
      units: [
        {
          code: 'U1',
          name: 'Nome oficial informado A',
          departments: [
            { code: 'D1', name: 'Setor A' },
            { code: 'D2', name: 'Setor B' },
          ],
        },
        {
          code: 'U2',
          name: 'Nome oficial informado B',
          departments: [{ code: 'D1', name: 'Setor A' }],
        },
      ],
    });

    await syncCatalogs(transaction, catalogs);
    await syncCatalogs(transaction, catalogs);

    expect(units.size).toBe(2);
    expect(departments.size).toBe(3);
    expect(unitCreate).toHaveBeenCalledTimes(2);
    expect(departmentCreate).toHaveBeenCalledTimes(3);
    expect(unitUpdate).not.toHaveBeenCalled();
    expect(departmentUpdate).not.toHaveBeenCalled();
  });
});

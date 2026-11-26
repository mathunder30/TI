import { describe, expect, it } from 'vitest';
import { catalogFileSchema } from './catalog-schema.js';

describe('arquivo de catálogos', () => {
  it('aceita várias unidades com vários setores e normaliza os códigos', () => {
    const parsed = catalogFileSchema.parse({
      version: 1,
      units: [
        {
          code: 'unidade-a',
          name: 'Nome informado pela instituição A',
          departments: [
            { code: 'setor-1', name: 'Setor 1' },
            { code: 'setor-2', name: 'Setor 2' },
          ],
        },
        {
          code: 'unidade-b',
          name: 'Nome informado pela instituição B',
          departments: [{ code: 'setor-1', name: 'Setor 1' }],
        },
      ],
    });

    expect(parsed.units).toHaveLength(2);
    expect(parsed.units[0]?.code).toBe('UNIDADE-A');
    expect(parsed.units[0]?.departments).toHaveLength(2);
  });

  it('recusa códigos duplicados sem alterar dados', () => {
    const result = catalogFileSchema.safeParse({
      version: 1,
      units: [
        { code: 'campus', name: 'Unidade A' },
        { code: 'CAMPUS', name: 'Unidade B' },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('recusa arquivo sem unidade', () => {
    expect(catalogFileSchema.safeParse({ version: 1, units: [] }).success).toBe(false);
  });
});

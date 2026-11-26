import { z } from 'zod';

const catalogCode = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .regex(/^[A-Za-z0-9_-]+$/)
  .transform((value) => value.toUpperCase());

const departmentSchema = z
  .object({
    code: catalogCode,
    name: z.string().trim().min(2).max(100),
    isActive: z.boolean().optional(),
  })
  .strict();

const unitSchema = z
  .object({
    code: catalogCode,
    name: z.string().trim().min(2).max(100),
    isActive: z.boolean().optional(),
    departments: z.array(departmentSchema).default([]),
  })
  .strict();

function duplicate(values: string[]): boolean {
  return (
    new Set(values.map((value) => value.trim().toLocaleLowerCase('pt-BR'))).size !== values.length
  );
}

export const catalogFileSchema = z
  .object({ version: z.literal(1), units: z.array(unitSchema).min(1) })
  .superRefine(({ units }, context) => {
    if (duplicate(units.map((unit) => unit.code))) {
      context.addIssue({
        code: 'custom',
        path: ['units'],
        message: 'Há códigos de unidade duplicados.',
      });
    }
    if (duplicate(units.map((unit) => unit.name))) {
      context.addIssue({
        code: 'custom',
        path: ['units'],
        message: 'Há nomes de unidade duplicados.',
      });
    }

    for (const [unitIndex, unit] of units.entries()) {
      if (duplicate(unit.departments.map((department) => department.code))) {
        context.addIssue({
          code: 'custom',
          path: ['units', unitIndex, 'departments'],
          message: 'Há códigos de setor duplicados nesta unidade.',
        });
      }
      if (duplicate(unit.departments.map((department) => department.name))) {
        context.addIssue({
          code: 'custom',
          path: ['units', unitIndex, 'departments'],
          message: 'Há nomes de setor duplicados nesta unidade.',
        });
      }
    }
  })
  .strict();

export type CatalogFile = z.output<typeof catalogFileSchema>;

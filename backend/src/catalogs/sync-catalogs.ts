import type { Prisma, Unit } from '../generated/prisma/client.ts';
import type { CatalogFile } from './catalog-schema.js';

export async function syncCatalogs(
  transaction: Prisma.TransactionClient,
  catalogs: CatalogFile,
): Promise<{ units: number; departments: number }> {
  let unitCount = 0;
  let departmentCount = 0;

  for (const unitInput of catalogs.units) {
    const existingUnit = await transaction.unit.findUnique({ where: { code: unitInput.code } });
    let unit: Unit;
    if (existingUnit) {
      const data = {
        ...(existingUnit.name !== unitInput.name ? { name: unitInput.name } : {}),
        ...(unitInput.isActive !== undefined && existingUnit.isActive !== unitInput.isActive
          ? { isActive: unitInput.isActive }
          : {}),
      };
      unit =
        Object.keys(data).length > 0
          ? await transaction.unit.update({ where: { id: existingUnit.id }, data })
          : existingUnit;
    } else {
      unit = await transaction.unit.create({
        data: {
          code: unitInput.code,
          name: unitInput.name,
          ...(unitInput.isActive !== undefined ? { isActive: unitInput.isActive } : {}),
        },
      });
    }
    unitCount += 1;

    for (const departmentInput of unitInput.departments) {
      const existingDepartment = await transaction.department.findUnique({
        where: { unitId_code: { unitId: unit.id, code: departmentInput.code } },
      });
      if (existingDepartment) {
        const data = {
          ...(existingDepartment.name !== departmentInput.name
            ? { name: departmentInput.name }
            : {}),
          ...(departmentInput.isActive !== undefined &&
          existingDepartment.isActive !== departmentInput.isActive
            ? { isActive: departmentInput.isActive }
            : {}),
        };
        if (Object.keys(data).length > 0) {
          await transaction.department.update({
            where: { id: existingDepartment.id },
            data,
          });
        }
      } else {
        await transaction.department.create({
          data: {
            code: departmentInput.code,
            name: departmentInput.name,
            unitId: unit.id,
            ...(departmentInput.isActive !== undefined
              ? { isActive: departmentInput.isActive }
              : {}),
          },
        });
      }
      departmentCount += 1;
    }
  }

  return { units: unitCount, departments: departmentCount };
}

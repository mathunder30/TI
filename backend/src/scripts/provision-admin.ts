import 'dotenv/config';
import argon2, { type HashOptions } from 'argon2';
import { z } from 'zod';
import { AuthProvider, UserRole } from '../generated/prisma/client.ts';
import { config as loadDotEnv } from 'dotenv';
import { resolve } from 'node:path';
import { prisma } from '../db/prisma.js';

loadDotEnv({ path: resolve(process.cwd(), '../.env') });

const inputSchema = z.object({
  TI_ADMIN_NAME: z.string().trim().min(2).max(160),
  TI_ADMIN_EMAIL: z.email().trim().toLowerCase().max(254),
  TI_ADMIN_PASSWORD: z.string().min(16).max(128),
  INITIAL_UNIT_CODE: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/),
  INITIAL_UNIT_NAME: z.string().trim().min(2).max(100),
  INITIAL_DEPARTMENT_CODE: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/),
  INITIAL_DEPARTMENT_NAME: z.string().trim().min(2).max(100),
});

const parsed = inputSchema.safeParse(process.env);
if (!parsed.success) {
  process.stderr.write(
    'Configuração inicial inválida. Defina nome, e-mail, senha do administrador e os dados da unidade/setor iniciais no ambiente do processo.\n',
  );
  process.exitCode = 1;
} else {
  const input = parsed.data;
  const passwordOptions: HashOptions = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  };
  const passwordHash = await argon2.hash(input.TI_ADMIN_PASSWORD, passwordOptions);

  try {
    await prisma.$transaction(async (transaction) => {
      const [existingAdmin, existingTi, existingEmail] = await Promise.all([
        transaction.adminAccount.findUnique({ where: { slot: 1 } }),
        transaction.user.findFirst({ where: { role: UserRole.TI } }),
        transaction.user.findUnique({ where: { email: input.TI_ADMIN_EMAIL } }),
      ]);
      if (existingAdmin || existingTi) {
        throw new Error('O administrador TI já foi provisionado.');
      }
      if (existingEmail) {
        throw new Error('O e-mail indicado já pertence a uma conta.');
      }

      const existingUnit = await transaction.unit.findUnique({
        where: { code: input.INITIAL_UNIT_CODE },
      });
      if (existingUnit && existingUnit.name !== input.INITIAL_UNIT_NAME) {
        throw new Error('O código da unidade já existe com outro nome.');
      }
      const unit =
        existingUnit ??
        (await transaction.unit.create({
          data: { code: input.INITIAL_UNIT_CODE, name: input.INITIAL_UNIT_NAME },
        }));
      if (!unit.isActive) throw new Error('A unidade inicial está desativada.');

      const existingDepartment = await transaction.department.findUnique({
        where: { unitId_code: { unitId: unit.id, code: input.INITIAL_DEPARTMENT_CODE } },
      });
      if (existingDepartment && existingDepartment.name !== input.INITIAL_DEPARTMENT_NAME) {
        throw new Error('O código do setor já existe com outro nome.');
      }
      const department =
        existingDepartment ??
        (await transaction.department.create({
          data: {
            code: input.INITIAL_DEPARTMENT_CODE,
            name: input.INITIAL_DEPARTMENT_NAME,
            unitId: unit.id,
          },
        }));
      if (!department.isActive) throw new Error('O setor inicial está desativado.');

      const admin = await transaction.user.create({
        data: {
          fullName: input.TI_ADMIN_NAME,
          email: input.TI_ADMIN_EMAIL,
          emailVerifiedAt: new Date(),
          role: UserRole.TI,
          tiSlot: 1,
          unitId: unit.id,
          departmentId: department.id,
        },
      });
      await transaction.authAccount.create({
        data: {
          userId: admin.id,
          provider: AuthProvider.PASSWORD,
          providerSubject: input.TI_ADMIN_EMAIL,
          passwordHash,
        },
      });
      await transaction.adminAccount.create({ data: { slot: 1, userId: admin.id } });
      await transaction.auditLog.create({
        data: {
          actorUserId: admin.id,
          actorNameSnapshot: 'Provisionamento inicial',
          action: 'ADMIN_TI_PROVISIONADO',
          entityType: 'ADMIN_ACCOUNT',
          entityId: admin.id,
          changes: { role: { from: null, to: UserRole.TI }, slot: 1 },
        },
      });
    });
    process.stdout.write('Administrador TI provisionado com sucesso.\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido.';
    process.stderr.write(`Não foi possível provisionar o administrador: ${message}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

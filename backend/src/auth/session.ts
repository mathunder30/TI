import type { Response } from 'express';
import { prisma } from '../db/prisma.js';
import { createAuthSession, decryptEphemeralSecret } from './crypto.js';

export async function createSessionResponse(userId: string, response: Response) {
  const session = await createAuthSession(userId, response);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      unit: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      authAccounts: { select: { provider: true } },
    },
  });

  return {
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      unit: user.unit,
      department: user.department,
      authProviders: user.authAccounts.map((account) => account.provider),
    },
  };
}

export async function getSessionResponse(userId: string, csrfTokenEncrypted: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      unit: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      authAccounts: { select: { provider: true } },
    },
  });
  return {
    csrfToken: decryptEphemeralSecret(csrfTokenEncrypted),
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      unit: user.unit,
      department: user.department,
      authProviders: user.authAccounts.map((account) => account.provider),
    },
  };
}

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import {
  TicketEventType,
  UserRole,
  type Prisma,
  type PrismaClient,
} from '../generated/prisma/client.ts';
import { env } from '../config/env.js';
import { HttpError } from '../http/errors.js';

export const attachmentStorageDirectory = resolve(env.ATTACHMENT_STORAGE_DIR);
const publicDirectory = resolve(
  fileURLToPath(new URL('../../../frontend/public', import.meta.url)),
);
const publicRelativeStoragePath = relative(publicDirectory, attachmentStorageDirectory);
if (
  publicRelativeStoragePath === '' ||
  (!publicRelativeStoragePath.startsWith(`..${sep}`) && publicRelativeStoragePath !== '..')
) {
  throw new Error('ATTACHMENT_STORAGE_DIR deve ficar fora da pasta pública do frontend.');
}

export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.ATTACHMENT_MAX_SIZE_BYTES, files: 1, fields: 0, parts: 1 },
});

export const receiveAttachment: RequestHandler = (request, response, next) => {
  attachmentUpload.single('file')(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(
        new HttpError(
          error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
          error.code === 'LIMIT_FILE_SIZE'
            ? 'O anexo excede o limite configurado.'
            : 'Envie somente um arquivo no campo file.',
        ),
      );
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
};

type Actor = { id: string; fullName: string; role: UserRole };
const allowedMimeByExtension: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

function safeOriginalName(value: string) {
  const name = [...basename(value.replaceAll('\\', '/'))]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  return name.slice(0, 255) || 'anexo';
}

export async function storeTicketAttachment(
  database: PrismaClient,
  ticketId: string,
  actor: Actor,
  file: Express.Multer.File | undefined,
) {
  if (!file) throw new HttpError(400, 'Selecione um arquivo para anexar.');
  if (file.size > env.ATTACHMENT_MAX_SIZE_BYTES)
    throw new HttpError(413, 'O anexo excede o limite configurado.');
  const originalName = safeOriginalName(file.originalname);
  const extension = extname(originalName).toLowerCase();
  const expectedMime = allowedMimeByExtension[extension];
  if (!expectedMime || file.mimetype !== expectedMime) {
    throw new HttpError(400, 'Envie JPG, JPEG, PNG ou PDF com extensão e MIME correspondentes.');
  }
  const detected = await fileTypeFromBuffer(file.buffer);
  if (
    !detected ||
    detected.mime !== expectedMime ||
    (expectedMime === 'application/pdf' && detected.ext !== 'pdf')
  ) {
    throw new HttpError(400, 'O conteúdo real do arquivo não corresponde ao tipo declarado.');
  }

  const id = randomUUID();
  const storageKey = `${id}${extension}`;
  const stagedPath = resolve(attachmentStorageDirectory, `${id}.uploading`);
  const storedPath = resolve(attachmentStorageDirectory, storageKey);
  try {
    await mkdir(attachmentStorageDirectory, { recursive: true, mode: 0o700 });
    await chmod(attachmentStorageDirectory, 0o700);
    await writeFile(stagedPath, file.buffer, { flag: 'wx', mode: 0o600 });
    const attachment = await database.$transaction(async (transaction) => {
      await transaction.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM tickets WHERE id = ${ticketId} FOR UPDATE`;
      const ticket = await transaction.ticket.findFirst({
        where: {
          id: ticketId,
          ...(actor.role === UserRole.FUNCIONARIO ? { requesterUserId: actor.id } : {}),
        },
      });
      if (!ticket) {
        throw new HttpError(404, 'Chamado não encontrado.');
      }
      const count = await transaction.ticketAttachment.count({ where: { ticketId } });
      if (count >= env.ATTACHMENT_MAX_PER_TICKET) {
        throw new HttpError(409, 'Este chamado atingiu o limite de anexos.');
      }
      await rename(stagedPath, storedPath);
      const created = await transaction.ticketAttachment.create({
        data: {
          ticketId,
          uploadedByUserId: actor.id,
          uploaderNameSnapshot: actor.fullName,
          storageKey,
          originalName,
          mimeType: expectedMime,
          byteSize: file.size,
        },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          byteSize: true,
          createdAt: true,
          uploaderNameSnapshot: true,
        },
      });
      await transaction.ticketHistory.create({
        data: {
          ticketId,
          actorUserId: actor.id,
          actorNameSnapshot: actor.fullName,
          eventType: TicketEventType.ANEXO,
          newValue: created.id,
        },
      });
      if (actor.role === UserRole.TI) {
        await transaction.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorNameSnapshot: actor.fullName,
            action: 'TICKET_ATTACHMENT_UPLOADED',
            entityType: 'TICKET_ATTACHMENT',
            entityId: created.id,
            changes: {
              ticketId,
              mimeType: expectedMime,
              byteSize: file.size,
            } as Prisma.InputJsonValue,
          },
        });
      }
      return created;
    });
    return attachment;
  } catch (error) {
    await Promise.all([rm(stagedPath, { force: true }), rm(storedPath, { force: true })]);
    throw error;
  }
}

export async function readStoredAttachment(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(jpg|jpeg|png|pdf)$/i.test(storageKey)) {
    throw new HttpError(404, 'Anexo não encontrado.');
  }
  try {
    return await readFile(resolve(attachmentStorageDirectory, storageKey));
  } catch {
    throw new HttpError(404, 'Anexo não encontrado.');
  }
}

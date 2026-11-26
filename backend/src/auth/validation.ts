import { z } from 'zod';
import { HttpError } from '../http/errors.js';

const email = z.email().trim().toLowerCase().max(254);
const password = z.string().min(12, 'Use uma senha com pelo menos 12 caracteres.').max(128);

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email,
  password,
  unitId: z.string().min(1).max(30),
  departmentId: z.string().min(1).max(30),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const emailOnlySchema = z.object({ email });
export const tokenSchema = z.object({ token: z.string().min(32).max(128) });
export const resetPasswordSchema = tokenSchema.extend({ password });
export const oauthStartSchema = z.object({ intent: z.enum(['login', 'signup', 'link']) });
export const pendingOAuthSchema = z.object({
  token: z.string().min(32).max(128),
  fullName: z.string().trim().min(2).max(160),
  unitId: z.string().min(1).max(30),
  departmentId: z.string().min(1).max(30),
});
export const linkPasswordSchema = z.object({ password });

export function validateBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(' ');
    throw new HttpError(400, message || 'Dados inválidos.');
  }
  return result.data;
}

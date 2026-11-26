import { z } from 'zod';
import { config as loadDotEnv } from 'dotenv';
import { resolve } from 'node:path';

loadDotEnv({ path: resolve(process.cwd(), '../.env') });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    FRONTEND_URL: z.url().default('http://localhost:5173'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET deve ter pelo menos 32 caracteres'),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_REDIRECT_URI: z.string().default(''),
    APPLE_CLIENT_ID: z.string().default(''),
    APPLE_TEAM_ID: z.string().default(''),
    APPLE_KEY_ID: z.string().default(''),
    APPLE_PRIVATE_KEY: z.string().default(''),
    APPLE_REDIRECT_URI: z.string().default(''),
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_FROM: z.string().default(''),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    ATTACHMENT_STORAGE_DIR: z.string().default(resolve(process.cwd(), '../private-attachments')),
    ATTACHMENT_MAX_SIZE_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(25 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    ATTACHMENT_MAX_PER_TICKET: z.coerce.number().int().min(1).max(20).default(5),
  })
  .superRefine((values, context) => {
    const groups = [
      {
        name: 'Google OAuth',
        values: [values.GOOGLE_CLIENT_ID, values.GOOGLE_CLIENT_SECRET, values.GOOGLE_REDIRECT_URI],
      },
      {
        name: 'Sign in with Apple',
        values: [
          values.APPLE_CLIENT_ID,
          values.APPLE_TEAM_ID,
          values.APPLE_KEY_ID,
          values.APPLE_PRIVATE_KEY,
          values.APPLE_REDIRECT_URI,
        ],
      },
      {
        name: 'SMTP',
        values: [values.SMTP_HOST, values.SMTP_USER, values.SMTP_PASSWORD, values.SMTP_FROM],
      },
    ];

    for (const group of groups) {
      const configuredCount = group.values.filter(Boolean).length;
      if (configuredCount > 0 && configuredCount < group.values.length) {
        context.addIssue({
          code: 'custom',
          path: [group.name],
          message: `Configure todos os campos de ${group.name} ou deixe-os vazios.`,
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`);
  throw new Error(`Configuração inválida:\n${details.join('\n')}`);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  googleOAuthEnabled: Boolean(
    parsed.data.GOOGLE_CLIENT_ID &&
    parsed.data.GOOGLE_CLIENT_SECRET &&
    parsed.data.GOOGLE_REDIRECT_URI,
  ),
  appleOAuthEnabled: Boolean(
    parsed.data.APPLE_CLIENT_ID &&
    parsed.data.APPLE_TEAM_ID &&
    parsed.data.APPLE_KEY_ID &&
    parsed.data.APPLE_PRIVATE_KEY &&
    parsed.data.APPLE_REDIRECT_URI,
  ),
  smtpEnabled: Boolean(
    parsed.data.SMTP_HOST &&
    parsed.data.SMTP_USER &&
    parsed.data.SMTP_PASSWORD &&
    parsed.data.SMTP_FROM,
  ),
};

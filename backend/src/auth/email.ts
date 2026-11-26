import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { HttpError } from '../http/errors.js';

const transporter = env.smtpEnabled
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    })
  : undefined;

function requireTransport() {
  if (!transporter) {
    throw new HttpError(503, 'Envio de e-mail não configurado no servidor.');
  }
  return transporter;
}

function authLink(path: string, token: string): string {
  const url = new URL(path, env.FRONTEND_URL);
  url.searchParams.set('token', token);
  return url.toString();
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const link = authLink('/auth/verify-email', token);
  try {
    await requireTransport().sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject: 'Confirme seu e-mail — Portal São Camilo',
      text: `Para ativar sua conta, acesse: ${link}\nEste link expira em 24 horas.`,
      html: `<p>Para ativar sua conta no Portal São Camilo, confirme seu e-mail:</p><p><a href="${link}">Confirmar e-mail</a></p><p>Este link expira em 24 horas.</p>`,
    });
  } catch {
    throw new HttpError(503, 'Não foi possível enviar o e-mail de verificação. Tente novamente.');
  }
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const link = authLink('/auth/reset-password', token);
  try {
    await requireTransport().sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject: 'Redefinição de senha — Portal São Camilo',
      text: `Para redefinir sua senha, acesse: ${link}\nEste link expira em 1 hora.`,
      html: `<p>Recebemos uma solicitação para redefinir sua senha:</p><p><a href="${link}">Redefinir senha</a></p><p>Este link expira em 1 hora. Se você não fez a solicitação, ignore este e-mail.</p>`,
    });
  } catch {
    throw new HttpError(503, 'Não foi possível enviar o e-mail de recuperação. Tente novamente.');
  }
}

export function emailDeliveryAvailable(): boolean {
  return Boolean(transporter);
}

import { z } from 'zod';

export const createTicketSchema = z
  .object({
    title: z.string().trim().min(5).max(200),
    description: z.string().trim().min(10).max(10_000),
    categoryId: z.string().trim().min(1).max(30),
    priority: z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA']),
  })
  .strict();

export type CreateTicketInput = z.output<typeof createTicketSchema>;

export const listTicketsQuerySchema = z
  .object({
    status: z
      .enum([
        'ABERTO',
        'EM_TRIAGEM',
        'EM_ATENDIMENTO',
        'AGUARDANDO_FUNCIONARIO',
        'RESOLVIDO',
        'FECHADO',
        'REABERTO',
        'CANCELADO',
      ])
      .optional(),
    priority: z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA']).optional(),
    categoryId: z.string().trim().min(1).max(30).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type ListTicketsQuery = z.output<typeof listTicketsQuerySchema>;

export const ticketMessageSchema = z.object({ body: z.string().trim().min(1).max(5_000) }).strict();
export const ticketReasonSchema = z
  .object({ reason: z.string().trim().min(10).max(2_000) })
  .strict();
export const ticketStatusChangeSchema = z
  .object({ status: z.enum(['EM_TRIAGEM', 'EM_ATENDIMENTO']) })
  .strict();
export const ticketResolutionSchema = z
  .object({ resolution: z.string().trim().min(10).max(5_000) })
  .strict();

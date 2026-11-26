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

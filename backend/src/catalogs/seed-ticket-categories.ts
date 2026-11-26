import type { Prisma } from '../generated/prisma/client.ts';

export const initialTicketCategories = [
  { code: 'HARDWARE', name: 'Hardware' },
  { code: 'SOFTWARE', name: 'Software' },
  { code: 'INTERNET_REDE', name: 'Internet e rede' },
  { code: 'IMPRESSORAS', name: 'Impressoras' },
  { code: 'ACESSOS_PERMISSOES', name: 'Acessos e permissões' },
  { code: 'SISTEMAS', name: 'Sistemas' },
  { code: 'TELEFONIA', name: 'Telefonia' },
  { code: 'MANUTENCAO_EQUIPAMENTOS', name: 'Manutenção de equipamentos' },
  { code: 'OUTROS', name: 'Outros' },
] as const;

export async function seedTicketCategories(transaction: Prisma.TransactionClient): Promise<number> {
  let insertedCount = 0;
  for (const category of initialTicketCategories) {
    const byCode = await transaction.ticketCategory.findUnique({ where: { code: category.code } });
    if (byCode) continue;
    const byName = await transaction.ticketCategory.findUnique({ where: { name: category.name } });
    if (byName) throw new Error('CATEGORY_NAME_CONFLICT');
    await transaction.ticketCategory.create({ data: category });
    insertedCount += 1;
  }
  return insertedCount;
}

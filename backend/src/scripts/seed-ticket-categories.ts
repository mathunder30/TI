import 'dotenv/config';
import {
  initialTicketCategories,
  seedTicketCategories,
} from '../catalogs/seed-ticket-categories.js';
import { prisma } from '../db/prisma.js';

try {
  const insertedCount = await prisma.$transaction(seedTicketCategories);
  process.stdout.write(
    `${initialTicketCategories.length} categoria(s) verificadas; ${insertedCount} nova(s) inserida(s).\n`,
  );
} catch {
  process.stderr.write(
    'Seed cancelado: foi encontrado conflito de código ou nome nas categorias. Nenhuma alteração parcial foi mantida.\n',
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

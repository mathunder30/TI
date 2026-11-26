import '../config/env.js';
import { prisma } from './prisma.js';

try {
  await prisma.$queryRaw`SELECT 1`;
  process.stdout.write('Conexão com o MySQL validada (SELECT 1).\n');
} catch {
  process.stderr.write('Não foi possível validar a conexão com o MySQL. Confira DATABASE_URL.\n');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

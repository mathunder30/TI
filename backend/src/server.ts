import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';

const server = app.listen(env.PORT, () => {
  process.stdout.write(`API São Camilo disponível na porta ${env.PORT}.\n`);
});

async function shutdown(signal: string) {
  process.stdout.write(`\n${signal}: encerrando API...\n`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { catalogFileSchema } from '../catalogs/catalog-schema.js';
import { syncCatalogs } from '../catalogs/sync-catalogs.js';
import { prisma } from '../db/prisma.js';

function fileArgument(): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf('--file');
  if (index < 0 || !args[index + 1] || args[index + 2]) return undefined;
  return args[index + 1];
}

const inputPath = fileArgument();
if (!inputPath) {
  process.stderr.write(
    'Uso: npm run catalogs:sync --workspace @sao-camilo/backend -- --file <caminho-do-arquivo-json>\n',
  );
  process.exitCode = 1;
} else {
  try {
    const rawFile = await readFile(resolve(inputPath), 'utf8');
    const parsedJson: unknown = JSON.parse(rawFile);
    const result = catalogFileSchema.safeParse(parsedJson);
    if (!result.success) {
      process.stderr.write(
        'Arquivo de catálogos inválido; revise a estrutura e os códigos duplicados.\n',
      );
      process.exitCode = 1;
    } else {
      const counts = await prisma.$transaction((transaction) =>
        syncCatalogs(transaction, result.data),
      );
      process.stdout.write(
        `Carga concluída: ${counts.units} unidade(s) e ${counts.departments} setor(es) processados.\n`,
      );
    }
  } catch (error) {
    const isUnique =
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
    process.stderr.write(
      isUnique
        ? 'Carga cancelada: há conflito de código ou nome com os registros existentes. Nenhuma alteração foi aplicada.\n'
        : 'Carga de catálogos não concluída; confirme o arquivo e a conexão com o banco. Nenhuma transação parcial foi mantida.\n',
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

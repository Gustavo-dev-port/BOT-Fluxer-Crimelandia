/**
 * Gera prisma/postgres/schema.prisma a partir de prisma/schema.prisma (fonte da verdade).
 * O Prisma fixa o banco no próprio schema, então produção (PostgreSQL) usa uma cópia
 * que só troca o provider. Rode depois de mudar o schema: npm run db:postgres:sync
 */
import { readFileSync, writeFileSync } from 'node:fs';

export function toPostgres(sqliteSchema) {
  const out = sqliteSchema.replace(/(datasource db \{[^}]*provider\s*=\s*)"sqlite"/, '$1"postgresql"');
  if (out === sqliteSchema) throw new Error('provider "sqlite" não encontrado no datasource');
  return `// ARQUIVO GERADO por scripts/sync-postgres-schema.mjs — não edite; edite prisma/schema.prisma.\n${out}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = readFileSync('prisma/schema.prisma', 'utf8');
  writeFileSync('prisma/postgres/schema.prisma', toPostgres(source));
  console.log('prisma/postgres/schema.prisma atualizado');
}

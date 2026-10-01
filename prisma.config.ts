/**
 * Configuração do Prisma 7 para o SQLite (desenvolvimento). O PostgreSQL de
 * produção usa prisma.postgres.config.ts. O .env é carregado aqui porque o
 * Prisma 7 não lê mais o .env sozinho.
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrl } from './src/database/url.ts';

const prismaDir = fileURLToPath(new URL('./prisma', import.meta.url));

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: resolveDatabaseUrl(process.env.DATABASE_URL ?? 'file:./fluxer.db', prismaDir) },
});

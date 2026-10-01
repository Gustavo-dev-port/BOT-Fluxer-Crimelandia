/** Configuração do Prisma 7 para o PostgreSQL (produção e npm run test:postgres). */
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/postgres/schema.prisma',
  migrations: { path: 'prisma/postgres/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});

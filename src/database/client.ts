import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { type Prisma, PrismaClient } from '../generated/prisma/client.js';
import { isSqlite, resolveDatabaseUrl } from './url.js';

/** Pasta prisma/ do projeto (src/database ou dist/database → ../../prisma). */
const prismaDir = fileURLToPath(new URL('../../prisma', import.meta.url));

/** URL efetiva: SQLite relativo a prisma/ (como no Prisma 6), PostgreSQL como veio. */
export const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL ?? 'file:./fluxer.db', prismaDir);

/**
 * Prisma 7 conecta por um adaptador de driver: libSQL para o SQLite (binários pelo
 * npm, inclusive no Windows) e pg para o PostgreSQL. Só o driver usado é carregado.
 */
async function createAdapter(url: string) {
  if (isSqlite(url)) {
    const { PrismaLibSql } = await import('@prisma/adapter-libsql');
    return new PrismaLibSql({ url });
  }
  const { PrismaPg } = await import('@prisma/adapter-pg');
  // 5 s para conectar, como o padrão do Prisma 6.
  return new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5_000 });
}

export const prisma = new PrismaClient({ adapter: await createAdapter(databaseUrl) });

/** Cliente aceito pelos serviços: o global ou o de uma transação. */
export type Db = PrismaClient | Prisma.TransactionClient;

export function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 15_000 });
}

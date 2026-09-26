import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

/** Cliente aceito pelos serviços: o global ou o de uma transação. */
export type Db = PrismaClient | Prisma.TransactionClient;

export function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 15_000 });
}

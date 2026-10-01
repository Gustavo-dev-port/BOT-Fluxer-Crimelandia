/**
 * URL do banco. No SQLite, `file:./fluxer.db` sempre foi relativo à pasta prisma/
 * (Prisma 6); com os adaptadores do Prisma 7 seria relativo à pasta atual. Para o bot,
 * o CLI e os testes usarem o mesmo arquivo, o caminho é resolvido a partir de prisma/.
 */
import { isAbsolute, resolve } from 'node:path';

export function resolveDatabaseUrl(url: string, prismaDir: string): string {
  if (!url.startsWith('file:')) return url;
  const raw = url.slice('file:'.length).replace(/^\/\/(?=\/)/, '');
  if (raw.startsWith('/') || isAbsolute(raw)) return url;
  // Caminho absoluto sem codificar (o CLI do Prisma não decodifica %20) e com barras "/",
  // que o libSQL e o Prisma aceitam inclusive no Windows: file:E:/Pasta com espaço/prisma/fluxer.db
  return `file:${resolve(prismaDir, raw).replaceAll('\\', '/')}`;
}

export const isSqlite = (url: string) => url.startsWith('file:');

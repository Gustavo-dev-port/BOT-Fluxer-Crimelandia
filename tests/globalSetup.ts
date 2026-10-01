import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Recria o banco de testes do zero a cada execução (SQLite ou PostgreSQL). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    for (const suffix of ['', '-journal']) rmSync(`prisma/test.db${suffix}`, { force: true });
    // Aplica as migrações (como em produção) num banco novo; o cliente já foi gerado.
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: 'file:./test.db' }, stdio: 'ignore' });
    return;
  }

  // PostgreSQL: só aceita bancos com "test" no nome, porque apaga tudo.
  const dbName = new URL(url).pathname.slice(1);
  if (!/test/i.test(dbName)) throw new Error(`TEST_DATABASE_URL precisa apontar para um banco de teste (nome atual: ${dbName})`);
  const env = { ...process.env, DATABASE_URL: url };
  const schema = '--config prisma.postgres.config.ts';
  execSync(`npx prisma db execute ${schema} --stdin`, { env, input: 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' });
  // Aplica as migrações de verdade: testa também o SQL de produção.
  execSync(`npx prisma migrate deploy ${schema}`, { env, stdio: 'ignore' });
}

/**
 * Roda a suíte de testes contra PostgreSQL.
 * Uso: TEST_DATABASE_URL=postgresql://usuario:senha@localhost:5432/fluxer_test npm run test:postgres
 * Gera o Prisma Client para PostgreSQL, roda os testes e volta o client para SQLite.
 */
import { execSync } from 'node:child_process';

if (!process.env.TEST_DATABASE_URL) {
  console.error('Defina TEST_DATABASE_URL (ex.: postgresql://fluxer:fluxer@localhost:5432/fluxer_test).');
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
let code = 0;
try {
  run('npx prisma generate --schema prisma/postgres/schema.prisma');
  run('npx vitest run');
} catch {
  code = 1;
} finally {
  run('npx prisma generate');
}
process.exit(code);

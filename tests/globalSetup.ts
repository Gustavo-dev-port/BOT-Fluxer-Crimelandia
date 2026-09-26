import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Recria o banco de testes (prisma/test.db) do zero a cada execução. */
export default function setup() {
  for (const suffix of ['', '-journal']) rmSync(`prisma/test.db${suffix}`, { force: true });
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'ignore',
  });
}

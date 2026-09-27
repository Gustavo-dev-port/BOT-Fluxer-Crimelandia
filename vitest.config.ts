import { defineConfig } from 'vitest/config';

// SQLite por padrão; `npm run test:postgres` define TEST_DATABASE_URL para rodar no PostgreSQL.
const databaseUrl = process.env.TEST_DATABASE_URL ?? 'file:./test.db';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    env: { DATABASE_URL: databaseUrl, WEEKLY_EVENT_ENABLED: 'false' },
    // Os testes de integração compartilham o mesmo banco.
    fileParallelism: false,
  },
});

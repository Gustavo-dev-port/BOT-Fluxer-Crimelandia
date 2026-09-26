import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    env: { DATABASE_URL: 'file:./test.db', WEEKLY_EVENT_ENABLED: 'false' },
    // Os testes de integração compartilham o mesmo arquivo SQLite.
    fileParallelism: false,
  },
});

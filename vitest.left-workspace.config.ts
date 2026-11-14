import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/manual/left-workspace-electron.test.ts'],
  },
});

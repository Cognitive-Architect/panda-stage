import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/research/c5-kf-00.test.ts'],
  },
});

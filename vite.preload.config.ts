import { defineConfig } from 'vite';
import path from 'node:path';

const entryName = process.env.PRELOAD_ENTRY;
if (entryName !== 'index' && entryName !== 'hidden') {
  throw new Error('PRELOAD_ENTRY must be either "index" or "hidden".');
}

export default defineConfig({
  build: {
    target: 'node22',
    outDir: 'dist-electron/preload',
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: path.resolve(__dirname, `src/preload/${entryName}.ts`),
      formats: ['cjs'],
      fileName: () => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});

import { defineConfig } from 'vite';
import path from 'node:path';

const entryName = process.env.PRELOAD_ENTRY;
if (
  entryName !== 'index' &&
  entryName !== 'hidden' &&
  entryName !== 'fla-parser' &&
  entryName !== 'fla-static-snapshot'
) {
  throw new Error('PRELOAD_ENTRY must be "index", "hidden", "fla-parser", or "fla-static-snapshot".');
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

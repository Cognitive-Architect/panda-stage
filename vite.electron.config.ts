import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        main: path.resolve(__dirname, 'electron/main/index.ts'),
        preload: path.resolve(__dirname, 'electron/preload/index.ts'),
      },
      formats: ['cjs'],
      fileName: (format, entryName) => `${entryName}.js`,
      outDir: 'dist/electron',
    },
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      external: ['electron', 'fs', 'path', 'os', 'child_process', 'util'],
    },
  },
});

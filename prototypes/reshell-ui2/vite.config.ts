import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone experiment entry. Not wired into the production Electron build.
export default defineConfig({ base: './', plugins: [react()], server: { port: 5199 } });

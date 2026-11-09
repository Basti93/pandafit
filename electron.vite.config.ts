import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import { themeChoice } from './src/web/theme-css';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), service: resolve('src/service/main.ts'), coach: resolve('src/coach/main.ts') } } },
  },
  renderer: {
    root: 'src/ui',
    // Only the brand font and the panda picture; the exercise pictures stay in the web app. A test keeps the copies equal to src/web/public/brand.
    publicDir: resolve('src/ui/public'),
    plugins: [react()],
    css: { postcss: { plugins: [themeChoice()] } },
    build: { rollupOptions: { input: resolve('src/ui/index.html') } },
  },
});

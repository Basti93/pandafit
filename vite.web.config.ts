import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const outDir = resolve('out/web');

/** Fills the service worker's file list and build id after everything, including public files, is written. */
function precache(): Plugin {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  return {
    name: 'pandafit-precache',
    apply: 'build',
    closeBundle() {
      // Exercise pictures are optional and loaded when an info is opened, so they stay out of the precache (offline: no picture).
      const files = walk(outDir).map((p) => '/' + relative(outDir, p).split('\\').join('/'))
        .filter((f) => f !== '/sw.js' && !f.endsWith('.map') && !f.startsWith('/exercises/')).sort();
      const list = ['/', ...files.filter((f) => f !== '/index.html'), '/index.html'];
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const sw = join(outDir, 'sw.js');
      const code = readFileSync(sw, 'utf8')
        .replace(/(["'`])__PRECACHE_LIST__\1/, () => JSON.stringify(list.filter((f) => f !== '/')))
        .replace(/(["'`])__BUILD_ID__\1/, () => JSON.stringify(hash.digest('hex').slice(0, 12)));
      if (code.includes('__PRECACHE_LIST__') || code.includes('__BUILD_ID__')) throw new Error('service worker placeholders were not replaced');
      // A classic service worker cannot import: a shared chunk would make every update fail to install, silently.
      if (/(^|[;\n])\s*import\s*[{*\w"'`]/.test(code)) throw new Error('sw.js imports another chunk: the app and the service worker must not share a module');
      writeFileSync(sw, code);
    },
  };
}

export default defineConfig(({ command }) => ({
  root: 'src/web',
  publicDir: 'public',
  plugins: [react(), ...(command === 'build' ? [precache()] : [])],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: { index: resolve('src/web/index.html'), sw: resolve('src/web/sw.ts') },
      // The worker keeps a stable name at the root so its scope is the whole app; everything else is hashed.
      output: { entryFileNames: (c) => (c.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
  server: {
    // Manual testing against a local Pandafit server: PANDAFIT_URL=http://127.0.0.1:8080 npm run dev:web
    proxy: Object.fromEntries(['/records', '/login', '/logout', '/me', '/device-token', '/healthz', '/push'].map((p) => [p, process.env.PANDAFIT_URL ?? 'http://127.0.0.1:8080'])),
  },
}));

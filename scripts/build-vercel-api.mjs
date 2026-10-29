import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

fs.mkdirSync(path.resolve(process.cwd(), 'api'), { recursive: true });

await build({
  entryPoints: ['server/vercel-entry.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  outfile: 'api/index.js',
  banner: {
    js: '// Fichier généré automatiquement par scripts/build-vercel-api.mjs — aucun secret inclus.',
  },
});

console.log('[build-vercel-api] api/index.js généré avec succès.');

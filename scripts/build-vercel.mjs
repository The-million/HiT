import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel/output');
const fn = join(out, 'functions/api/index.func');
const run = (args, cwd = root, env = process.env) => execFileSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
// Dependencies are installed by Vercel's installCommand. No secrets are read or
// written into the output; connection information is supplied only at runtime.
run(['node_modules/vite/bin/vite.js', 'build'], join(root, 'frontend'), { ...process.env, VITE_SERVERLESS: '1' });
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });
cpSync(join(root, 'frontend/dist'), join(out, 'static'), { recursive: true });
run(['scripts/catalogue/stage-media.mjs', join(out, 'static')]);
// Only runtime source and installed production dependencies belong in the function.
cpSync(join(root, 'api'), join(fn, 'api'), {
  recursive: true,
  filter: source => !['node_modules', 'test', '.env'].includes(source.split('/').at(-1))
});
cpSync(join(root, 'api/node_modules'), join(fn, 'api/node_modules'), {
  recursive: true,
  filter: source => !['@electric-sql', '.cache'].includes(source.split('/').at(-1))
});
writeFileSync(join(fn, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x', handler: 'api/serverless/entry.js', launcherType: 'Nodejs',
  shouldAddHelpers: false, maxDuration: 60, regions: ['sin1']
}, null, 2));
writeFileSync(join(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/api(?:/.*)?$', dest: '/api/index' },
    { src: '^/sw\\.js$', headers: { 'Cache-Control': 'no-cache' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/(?:assets|exercise-media)/.*$', status: 404 },
    { src: '^/.*$', dest: '/index.html' }
  ]
}, null, 2));
console.log('Vercel output ready in .vercel/output');

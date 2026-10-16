import pg from 'pg';
import { createPostgresStore } from './postgres.js';
import { createHandler } from './handler.js';

// Set before importing upstream modules, whose config is read at module scope.
process.env.OPENGYM_SERVERLESS = '1';
process.env.COACH_DISABLED = '1';
process.env.MEDIA_UPLOADS = '0';
process.env.DEFAULT_LANG ||= 'fr';
process.env.FIRST_USER_ADMIN ||= '1';
process.env.INVITE_ONLY ||= '1';
process.env.ALLOW_GUEST ||= '0';
process.env.PASSWORD_LOGIN ||= '1';
process.env.TRUST_PROXY = '1';

let handlerPromise;
async function initialize() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const origin = new URL(process.env.ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== process.env.ORIGIN) throw new Error('ORIGIN must be an HTTPS origin without a trailing slash');
  if (process.env.RP_ID !== origin.hostname) throw new Error('RP_ID must match ORIGIN hostname');
  const server = await import('../server.js');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, allowExitOnIdle: true });
  pool.on('error', () => console.error('openGym: database connection interrupted'));
  return createHandler({ server, store: createPostgresStore(pool) });
}

export default async function handler(req, res) {
  let run;
  try {
    handlerPromise ||= initialize().catch(error => { handlerPromise = undefined; throw error; });
    run = await handlerPromise;
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'server configuration incomplete' }));
  }
  // Vercel supplies x-forwarded-for. Do not let a caller override the
  // password throttle/audit address using Cloudflare-specific headers.
  delete req.headers['cf-connecting-ip'];
  delete req.headers['x-real-ip'];
  return run(req, res);
}

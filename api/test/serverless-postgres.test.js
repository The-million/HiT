import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresStore } from '../serverless/postgres.js';
import { createHandler, BufferedResponse } from '../serverless/handler.js';

Object.assign(process.env, {
  OPENGYM_SERVERLESS: '1', SESSION_SECRET: 'test-only-secret-that-is-at-least-32-characters',
  BOOTSTRAP_INVITE_CODE: 'TESTBOOTSTRAP123456', DEFAULT_LANG: 'fr',
  ORIGIN: 'https://gym.example.com', RP_ID: 'gym.example.com', FIRST_USER_ADMIN: '1',
  INVITE_ONLY: '1', ALLOW_GUEST: '0', PASSWORD_LOGIN: '1', COACH_DISABLED: '1', MEDIA_UPLOADS: '0'
});
const server = await import('../server.js');
const db = new PGlite();
after(() => db.close());
// Real PostgreSQL queries through PGlite; the request queue handles concurrency in
// this process. Production additionally uses pg and SELECT FOR UPDATE across instances.
const pool = {
  query: (...args) => db.query(...args),
  connect: async () => ({ query: (...args) => db.query(...args), release() {} })
};
const store = createPostgresStore(pool);
let handle = createHandler({ store, server });
const cookieOf = res => [res.headers['set-cookie']].flat()[0]?.split(';')[0];
async function request(method, url, body, cookie, headers = {}, handler = handle) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, url, headers: { origin: process.env.ORIGIN, ...(cookie ? { cookie } : {}), ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new BufferedResponse();
  await handler(req, res);
  return { ...res, json: JSON.parse(res.body || '{}') };
}
let admin, friend, adminCookie, friendCookie;
test('Vercel storage: French config and private bootstrap', async () => {
  const res = await request('GET', '/api/config');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.default_lang, 'fr');
  assert.equal(res.json.invite_only, true);
  assert.equal(res.json.allow_guest, false);
  assert.equal(res.json.push, false);
  assert.equal(res.json.media, undefined);
  assert.equal((await request('POST', '/api/register/password', { name: 'Intruder', password: 'A-long-test-passphrase!' })).statusCode, 403);
});
test('first account requires the bootstrap invitation and becomes admin', async () => {
  const res = await request('POST', '/api/register/password', { name: 'Owner', password: 'A-long-test-passphrase!', code: process.env.BOOTSTRAP_INVITE_CODE });
  assert.equal(res.statusCode, 200, res.body);
  admin = res.json.user;
  assert.equal(admin.admin, true);
  adminCookie = cookieOf(res);
  assert.match(String(res.headers['set-cookie']), /Secure/);
  assert.equal((await request('POST', '/api/register/password', { name: 'Reuse', password: 'A-long-test-passphrase!', code: process.env.BOOTSTRAP_INVITE_CODE })).statusCode, 403);
});
test('new adapter restores sessions, invitations and per-user data', async () => {
  handle = createHandler({ store: createPostgresStore(pool), server });
  assert.equal((await request('GET', '/api/me', undefined, adminCookie)).json.user.id, admin.id);
  const invite = await request('POST', '/api/admin/invites/new', { note: 'Ami' }, adminCookie);
  assert.equal(invite.statusCode, 200, invite.body);
  const res = await request('POST', '/api/register/password', { name: 'Friend', password: 'Another-long-passphrase!', code: invite.json.invite.code });
  assert.equal(res.statusCode, 200, res.body);
  friend = res.json.user;
  friendCookie = cookieOf(res);
  assert.equal(friend.admin, false);
  assert.equal((await request('GET', '/api/admin/users', undefined, friendCookie)).statusCode, 403);
  const put = await request('PUT', '/api/data', { state: { workouts: [{ id: 'w1', d: '2026-10-16', entries: [] }], routines: [], lang: 'fr' }, baseRev: 0 }, adminCookie);
  assert.equal(put.statusCode, 200, put.body);
  assert.equal((await request('GET', '/api/data', undefined, adminCookie)).json.state.workouts[0].id, 'w1');
  assert.equal((await request('GET', '/api/data', undefined, friendCookie)).json.state, null);
  assert.equal((await request('GET', '/api/data')).statusCode, 401);
});
test('two concurrent saves from the same revision produce one conflict, not data loss', async () => {
  const current = await request('GET', '/api/data', undefined, adminCookie);
  const body = n => ({ state: { ...current.json.state, goalWeight: n }, baseRev: current.json.rev });
  const results = await Promise.all([
    request('PUT', '/api/data', body(70), adminCookie),
    request('PUT', '/api/data', body(80), adminCookie)
  ]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal((await request('GET', '/api/data', undefined, adminCookie)).json.state.goalWeight, 70);
});
test('passkey challenge is persisted and consumed across adapter recreation', async () => {
  assert.equal((await request('POST', '/api/login/options', {})).statusCode, 200);
  const row = (await db.query('SELECT payload FROM opengym_instance WHERE id = 1')).rows[0].payload;
  assert.equal(row.runtime.challenges.length, 1);
  const cid = row.runtime.challenges[0][0];
  handle = createHandler({ store: createPostgresStore(pool), server });
  await request('POST', '/api/login/verify', { cid, credential: {} });
  const after = (await db.query('SELECT payload FROM opengym_instance WHERE id = 1')).rows[0].payload;
  assert.equal(after.runtime.challenges.length, 0);
});
test('password throttling survives recreation; missing features are refused', async () => {
  for (let i = 0; i < 7; i++) {
    handle = createHandler({ store: createPostgresStore(pool), server });
    const res = await request('POST', '/api/login/password', { name: 'Owner', password: 'wrong-password' });
    if (i === 6) assert.equal(res.statusCode, 429, res.body);
  }
  for (const url of ['/api/push/public-key', '/api/coach/config', '/api/media/missing']) {
    assert.equal((await request('GET', url, undefined, adminCookie)).statusCode, 404);
  }
});
test('cross-origin state changes are rejected', async () => {
  assert.equal((await request('PUT', '/api/data', { state: { lang: 'de' } }, adminCookie, { origin: 'https://elsewhere.example' })).statusCode, 403);
});
test('failed transaction rolls back and never sends a success or session cookie', async () => {
  const original = (await request('GET', '/api/data', undefined, adminCookie)).json;
  const failingStore = { transaction: run => store.transaction(async snapshot => {
    await run(snapshot);
    throw new Error('simulated storage failure before commit');
  }) };
  const failing = createHandler({ store: failingStore, server });
  const res = await request('PUT', '/api/data', { state: { lang: 'de' } }, adminCookie, {}, failing);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['set-cookie'], undefined);
  assert.deepEqual((await request('GET', '/api/data', undefined, adminCookie)).json, original);
});
test('bootstrap invitation is not recreated after use', async () => {
  const invites = (await request('GET', '/api/admin/invites', undefined, adminCookie)).json.invites;
  assert.equal(invites.filter(i => i.code === process.env.BOOTSTRAP_INVITE_CODE).length, 1);
  assert.equal(invites.find(i => i.code === process.env.BOOTSTRAP_INVITE_CODE).usedBy, admin.id);
});

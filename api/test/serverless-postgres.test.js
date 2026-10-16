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

test('friends: exact lookup, authorizations, crossed and repeated requests', async () => {
  const invite = await request('POST', '/api/admin/invites/new', { note: 'Third profile' }, adminCookie);
  const registered = await request('POST', '/api/register/password', {
    name: 'Charlie', password: 'Charlie-long-test-passphrase!', code: invite.json.invite.code
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const charlie = registered.json.user;
  const charlieCookie = cookieOf(registered);

  assert.equal((await request('GET', '/api/friends')).statusCode, 401);
  assert.equal((await request('POST', '/api/friends/lookup', { query: 'Friend' })).statusCode, 401);
  assert.equal((await request('POST', '/api/friends/request', { targetId: friend.id })).statusCode, 401);
  const empty = await request('GET', '/api/friends', undefined, adminCookie);
  assert.equal(empty.json.code, admin.id);
  assert.deepEqual(empty.json.relationships, []);
  assert.equal((await request('POST', '/api/friends/lookup', { query: 'Fri' }, adminCookie)).statusCode, 404);
  assert.equal((await request('POST', '/api/friends/lookup', { query: 'friend' }, adminCookie)).json.user.id, friend.id);
  assert.equal((await request('POST', '/api/friends/lookup', { query: friend.id }, adminCookie)).json.user.id, friend.id);
  assert.equal((await request('POST', '/api/friends/request', { targetId: admin.id }, adminCookie)).statusCode, 400);

  const sent = await request('POST', '/api/friends/request', { targetId: friend.id, from: charlie.id }, adminCookie);
  assert.equal(sent.statusCode, 200, sent.body);
  const id = sent.json.relationship.id;
  assert.equal(sent.json.relationship.direction, 'outgoing');
  assert.deepEqual(Object.keys(sent.json.relationship.user).sort(), ['id', 'name']);
  assert.equal((await request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie)).json.relationship.id, id);
  assert.equal((await request('POST', '/api/friends/request', { targetId: admin.id }, friendCookie)).statusCode, 409);
  assert.equal((await request('POST', '/api/friends/accept', { id }, adminCookie)).statusCode, 403);
  assert.equal((await request('POST', '/api/friends/accept', { id }, charlieCookie)).statusCode, 404);
  assert.equal((await request('POST', '/api/friends/cancel', { id }, friendCookie)).statusCode, 403);
  assert.equal((await request('POST', '/api/friends/decline', { id }, adminCookie)).statusCode, 403);
  assert.equal((await request('POST', '/api/friends/accept', { id }, friendCookie)).json.relationship.status, 'accepted');
  assert.equal((await request('POST', '/api/friends/accept', { id }, friendCookie)).statusCode, 200);
  assert.equal((await request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie)).json.relationship.status, 'accepted');
  handle = createHandler({ store: createPostgresStore(pool), server });
  assert.equal((await request('GET', '/api/friends', undefined, friendCookie)).json.relationships[0].user.id, admin.id);
  assert.equal((await request('GET', '/api/friends', undefined, charlieCookie)).json.relationships.length, 0);
  assert.equal((await request('POST', '/api/friends/remove', { id }, charlieCookie)).statusCode, 404);
  assert.equal((await request('POST', '/api/friends/remove', { id }, adminCookie)).statusCode, 200);
  assert.deepEqual((await request('GET', '/api/friends', undefined, friendCookie)).json.relationships, []);

  const again = await request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie);
  assert.equal((await request('POST', '/api/friends/decline', { id: again.json.relationship.id }, friendCookie)).statusCode, 200);
  assert.deepEqual((await request('GET', '/api/friends', undefined, adminCookie)).json.relationships, []);
  const third = await request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie);
  assert.equal((await request('POST', '/api/friends/cancel', { id: third.json.relationship.id }, adminCookie)).statusCode, 200);
  assert.deepEqual((await request('GET', '/api/friends', undefined, friendCookie)).json.relationships, []);

  const fromCharlie = await request('POST', '/api/friends/request', { targetId: friend.id }, charlieCookie);
  assert.equal(fromCharlie.statusCode, 200, fromCharlie.body);
  assert.equal((await request('POST', '/api/admin/user/disable', { id: charlie.id, disabled: true }, adminCookie)).statusCode, 200);
  assert.deepEqual((await request('GET', '/api/friends', undefined, friendCookie)).json.relationships, []);
  assert.equal((await request('GET', '/api/friends', undefined, charlieCookie)).statusCode, 401);
  assert.equal((await request('POST', '/api/admin/user/disable', { id: charlie.id, disabled: false }, adminCookie)).statusCode, 200);
  assert.deepEqual((await request('GET', '/api/friends', undefined, charlieCookie)).json.relationships, []);
  assert.equal((await request('POST', '/api/admin/user/delete', { id: charlie.id }, adminCookie)).statusCode, 200);
  assert.equal((await request('POST', '/api/friends/lookup', { query: charlie.id }, adminCookie)).statusCode, 404);
});

test('friends: CSRF and failed transaction leave no relation or false success', async () => {
  assert.equal((await request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie, { origin: 'https://elsewhere.example' })).statusCode, 403);
  const failingStore = { transaction: run => store.transaction(async snapshot => { await run(snapshot); throw new Error('rollback'); }) };
  const failing = createHandler({ store: failingStore, server });
  const result = await request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie, {}, failing);
  assert.equal(result.statusCode, 503);
  assert.deepEqual((await request('GET', '/api/friends', undefined, adminCookie)).json.relationships, []);
});

test('friends: simultaneous sends create one relationship, and a crossed send does not overwrite it', async () => {
  const two = await Promise.all([
    request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie),
    request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie)
  ]);
  assert.deepEqual(two.map(r => r.statusCode), [200, 200]);
  assert.equal(two[0].json.relationship.id, two[1].json.relationship.id);
  const crossed = await request('POST', '/api/friends/request', { targetId: admin.id }, friendCookie);
  assert.equal(crossed.statusCode, 409);
  assert.equal(crossed.json.code, 'incoming-request');
  assert.equal((await request('GET', '/api/friends', undefined, friendCookie)).json.relationships.length, 1);
  assert.equal((await request('POST', '/api/friends/cancel', { id: two[0].json.relationship.id }, adminCookie)).statusCode, 200);
});

test('manual workout shares expose only completed public fields to accepted friends and revoke every access path', async () => {
  const invite = await request('POST', '/api/admin/invites/new', { note: 'Share privacy test' }, adminCookie);
  const registered = await request('POST', '/api/register/password', {
    name: 'Outside', password: 'Outside-long-test-passphrase!', code: invite.json.invite.code
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const outsider = registered.json.user;
  const outsiderCookie = cookieOf(registered);
  const direct = cookie => request('GET', `/api/friends/workout?ownerId=${admin.id}&workoutId=w1`, undefined, cookie);
  const profile = cookie => request('GET', `/api/friends/profile?id=${admin.id}`, undefined, cookie);
  const source = async (workouts, extra = {}) => {
    const before = (await request('GET', '/api/data', undefined, adminCookie)).json;
    return request('PUT', '/api/data', {
      state: { ...before.state, ...extra, workouts }, baseRev: before.rev
    }, adminCookie);
  };
  const workout = weight => ({
    id: 'w1', d: '2026-10-16', start: 1000, end: 61000, name: 'Push day',
    note: 'PRIVATE_WORKOUT_NOTE', bw: 87, media: ['PRIVATE_MEDIA'],
    entries: [{ id: 'custom1', note: 'PRIVATE_ENTRY_NOTE', sets: [
      { done: true, w: weight, r: 8, note: 'PRIVATE_SET_NOTE' },
      { done: false, w: 999, r: 12, note: 'PRIVATE_UNFINISHED' }
    ] }]
  });
  assert.equal((await source([workout(40), { id: 'w2', d: '2026-10-16', entries: [{ id: 'custom1', sets: [{ done: true, w: 999, r: 1 }] }] }], {
    customEx: [{ id: 'custom1', n: 'Demo lift', note: 'PRIVATE_EXERCISE_NOTE' }], unit: 'kg'
  })).statusCode, 200);
  assert.equal((await request('GET', '/api/shares')).statusCode, 401);
  assert.equal((await request('GET', '/api/friends/feed')).statusCode, 401);
  assert.equal((await direct()).statusCode, 401);
  assert.equal((await request('POST', '/api/shares/publish', { workoutId: 'w1' })).statusCode, 401);
  assert.equal((await request('POST', '/api/shares/publish', { workoutId: 'w1' }, outsiderCookie)).statusCode, 404);
  assert.equal((await request('POST', '/api/shares/publish', { workoutId: 'w1' }, adminCookie,
    { origin: 'https://elsewhere.example' })).statusCode, 403);

  const published = await request('POST', '/api/shares/publish', { workoutId: 'w1', ownerId: outsider.id }, adminCookie);
  assert.equal(published.statusCode, 200, published.body);
  assert.equal((await request('POST', '/api/shares/publish', { workoutId: 'w1' }, adminCookie)).json.share.publishedAt, published.json.share.publishedAt);
  assert.equal((await direct(friendCookie)).statusCode, 404);
  assert.equal((await profile(friendCookie)).statusCode, 404);
  assert.deepEqual((await request('GET', '/api/friends/feed', undefined, friendCookie)).json.workouts, []);
  const sent = await request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie);
  assert.equal((await direct(friendCookie)).statusCode, 404);
  assert.equal((await request('POST', '/api/friends/accept', { id: sent.json.relationship.id }, friendCookie)).statusCode, 200);

  const visible = await direct(friendCookie);
  assert.equal(visible.statusCode, 200, visible.body);
  assert.deepEqual(Object.keys(visible.json.workout).sort(), ['date', 'durationMs', 'entries', 'id', 'title', 'truncated', 'unit']);
  assert.deepEqual(visible.json.workout.entries, [{ id: 'custom1', name: 'Demo lift', sets: [{ w: 40, r: 8 }] }]);
  assert.equal(visible.json.workout.durationMs, 60000);
  assert.deepEqual(Object.keys(visible.json.owner).sort(), ['id', 'name']);
  assert.doesNotMatch(visible.body, /PRIVATE_|999/);
  const feed = await request('GET', '/api/friends/feed', undefined, friendCookie);
  assert.equal(feed.json.workouts.length, 1);
  assert.doesNotMatch(feed.body, /PRIVATE_|999/);
  const progress = await profile(friendCookie);
  assert.equal(progress.json.workouts.length, 1);
  assert.equal(progress.json.progress.exercises[0].best, 40);
  assert.equal(progress.json.progress.exercises[0].sessions, 1);
  assert.equal(progress.json.progress.weeks.reduce((n, w) => n + w.count, 0), 1);
  assert.doesNotMatch(progress.body, /PRIVATE_|999/);
  assert.equal((await direct(outsiderCookie)).statusCode, 404);
  assert.equal((await profile(outsiderCookie)).statusCode, 404);
  assert.equal((await request('POST', '/api/shares/revoke', { workoutId: 'w1' }, outsiderCookie)).statusCode, 404);

  assert.equal((await source([workout(45)])).statusCode, 200);
  assert.equal((await direct(friendCookie)).json.workout.entries[0].sets[0].w, 45);
  assert.equal((await profile(friendCookie)).json.progress.exercises[0].best, 45);
  const failingStore = { transaction: run => store.transaction(async snapshot => { await run(snapshot); throw new Error('rollback'); }) };
  const failing = createHandler({ store: failingStore, server });
  assert.equal((await request('POST', '/api/shares/revoke', { workoutId: 'w1' }, adminCookie, {}, failing)).statusCode, 503);
  assert.equal((await direct(friendCookie)).statusCode, 200);
  handle = createHandler({ store: createPostgresStore(pool), server });
  assert.equal((await direct(friendCookie)).statusCode, 200);
  assert.equal((await request('POST', '/api/shares/revoke', { workoutId: 'w1' }, adminCookie)).statusCode, 200);
  assert.equal((await direct(friendCookie)).statusCode, 404);
  assert.deepEqual((await request('GET', '/api/friends/feed', undefined, friendCookie)).json.workouts, []);
  assert.equal((await request('POST', '/api/shares/publish', { workoutId: 'w1' }, adminCookie)).statusCode, 200);
  assert.equal((await request('POST', '/api/friends/remove', { id: sent.json.relationship.id }, friendCookie)).statusCode, 200);
  assert.equal((await direct(friendCookie)).statusCode, 404);
  assert.equal((await profile(friendCookie)).statusCode, 404);
  const reSent = await request('POST', '/api/friends/request', { targetId: friend.id }, adminCookie);
  assert.equal((await request('POST', '/api/friends/accept', { id: reSent.json.relationship.id }, friendCookie)).statusCode, 200);
  assert.equal((await direct(friendCookie)).statusCode, 200);
  assert.equal((await source([])).statusCode, 200);
  assert.equal((await direct(friendCookie)).statusCode, 404);
  assert.deepEqual((await request('GET', '/api/shares', undefined, adminCookie)).json.shares, []);
  assert.equal((await source([workout(60)])).statusCode, 200);
  assert.equal((await direct(friendCookie)).statusCode, 404);
  assert.equal((await request('POST', '/api/admin/user/disable', { id: friend.id, disabled: true }, adminCookie)).statusCode, 200);
  assert.equal((await direct(friendCookie)).statusCode, 401);
  assert.equal((await request('PUT', '/api/data', { state: {
    workouts: [{ id: 'outside-w', d: '2026-10-16', entries: [{ id: 'custom1', sets: [{ done: true, w: 20, r: 5 }] }] }]
  }, baseRev: 0 }, outsiderCookie)).statusCode, 200);
  const outsideRequest = await request('POST', '/api/friends/request', { targetId: admin.id }, outsiderCookie);
  assert.equal((await request('POST', '/api/friends/accept', { id: outsideRequest.json.relationship.id }, adminCookie)).statusCode, 200);
  assert.equal((await request('POST', '/api/shares/publish', { workoutId: 'outside-w' }, outsiderCookie)).statusCode, 200);
  const outsideDirect = () => request('GET', `/api/friends/workout?ownerId=${outsider.id}&workoutId=outside-w`, undefined, adminCookie);
  assert.equal((await outsideDirect()).statusCode, 200);
  assert.equal((await request('POST', '/api/admin/user/disable', { id: outsider.id, disabled: true }, adminCookie)).statusCode, 200);
  assert.equal((await outsideDirect()).statusCode, 404);
  const saved = (await db.query('SELECT payload FROM opengym_instance WHERE id = 1')).rows[0].payload;
  assert.equal(JSON.parse(saved.documents['db.json']).social.shares.some(s => s.ownerId === outsider.id), false);
});

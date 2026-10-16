import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicWorkout, sharedProgress } from '../social-share.js';

test('shared progress counts only published projections and one session per exercise per workout', () => {
  const state = { unit: 'kg', workouts: [], customEx: [{ id: 'lift', n: 'Lift', secret: 'PRIVATE' }] };
  const source = (id, date, weights) => ({
    id, d: date, name: 'Training', note: 'PRIVATE', entries: weights.map(w => ({
      id: 'lift', note: 'PRIVATE', sets: [{ done: true, w, r: 5 }, { done: false, w: 999, r: 1 }]
    }))
  });
  const published = [publicWorkout(source('a', '2026-10-05', [40, 42]), state),
    publicWorkout(source('b', '2026-10-12', [45]), state)];
  const privateWorkout = publicWorkout(source('c', '2026-10-12', [999]), state);
  assert.doesNotMatch(JSON.stringify(published), /PRIVATE|999/);
  const progress = sharedProgress(published, new Date('2026-10-16T00:00:00Z'));
  assert.deepEqual(progress.exercises, [{ id: 'lift', name: 'Lift', first: 42, latest: 45, best: 45, sessions: 2 }]);
  assert.equal(progress.weeks.reduce((count, week) => count + week.count, 0), 2);
  assert.equal(privateWorkout.entries[0].sets[0].w, 999);
});

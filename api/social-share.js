// The only workout fields another account may receive. Keep this independent of /api/data:
// a newly added private field in the personal document must never appear in a social response.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function workoutKey(workout) {
  if (!object(workout)) return null;
  if (typeof workout.id === 'string' && workout.id && workout.id.length <= 120) return workout.id;
  if (typeof workout.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(workout.d) && finite(workout.start) !== null)
    return `${workout.d}|${workout.start}`;
  return null;
}

function completedSet(set, side) {
  if (!object(set) || set.done !== true) return null;
  const result = side ? { side } : {};
  for (const field of ['w', 'r', 'min', 'sec']) {
    const value = finite(set[field]);
    if (value !== null) result[field] = value;
  }
  return result;
}

export function publicWorkout(workout, state) {
  const id = workoutKey(workout);
  if (!id) return null;
  const custom = new Map(list(state?.customEx).filter(object).map(ex => [ex.id, ex.n || ex.name]));
  const entries = [];
  let truncated = list(workout.entries).length > 100;
  for (const entry of list(workout.entries).slice(0, 100)) {
    if (!object(entry) || typeof entry.id !== 'string') continue;
    const sets = [];
    if (list(entry.sets).length > 200) truncated = true;
    for (const set of list(entry.sets).slice(0, 200)) {
      if (object(set?.sides) && object(set.sides.L) && object(set.sides.R)) {
        for (const side of ['L', 'R']) {
          const projected = completedSet(set.sides[side], side);
          if (projected) sets.push(projected);
        }
      } else {
        const projected = completedSet(set);
        if (projected) sets.push(projected);
      }
    }
    if (sets.length) entries.push({ id: entry.id.slice(0, 120), name: String(custom.get(entry.id) || entry.id).slice(0, 120), sets });
  }
  const start = finite(workout.start);
  const end = finite(workout.end);
  return {
    id, title: String(workout.name || '').slice(0, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(workout.d || '')) ? workout.d : '',
    durationMs: start !== null && end !== null ? Math.min(86400000, Math.max(0, end - start)) : null,
    unit: state?.unit === 'lb' ? 'lb' : 'kg', entries, truncated
  };
}

// All figures here are derived exclusively from the publicWorkout projections supplied above.
// The caller decides which shares are authorized before invoking this function.
export function sharedProgress(workouts, now = new Date()) {
  const ordered = [...workouts].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const weeks = [];
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  for (let i = 7; i >= 0; i--) {
    const day = new Date(monday);
    day.setUTCDate(day.getUTCDate() - i * 7);
    weeks.push({ start: day.toISOString().slice(0, 10), count: 0 });
  }
  const exercises = new Map();
  for (const workout of ordered) {
    const week = weeks.findLast(w => workout.date >= w.start);
    if (week && workout.date < new Date(new Date(week.start + 'T00:00:00Z').getTime() + 7 * 86400000).toISOString().slice(0, 10)) week.count++;
    const workoutWeights = new Map();
    for (const entry of workout.entries) {
      const weights = entry.sets.map(s => s.w).filter(w => typeof w === 'number' && w > 0);
      if (!weights.length) continue;
      const max = Math.max(...weights);
      const prior = workoutWeights.get(entry.id);
      workoutWeights.set(entry.id, { name: entry.name, max: Math.max(max, prior?.max || 0) });
    }
    for (const [id, { name, max }] of workoutWeights) {
      const prev = exercises.get(id);
      if (!prev) exercises.set(id, { id, name, first: max, latest: max, best: max, sessions: 1 });
      else { prev.latest = max; prev.best = Math.max(prev.best, max); prev.sessions++; prev.name = name; }
    }
  }
  return { weeks, exercises: [...exercises.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)).slice(0, 8) };
}

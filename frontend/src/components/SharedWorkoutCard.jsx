import { EXIDX } from '../lib/exercises.js'
import { fmtDate, fmtDur, fmtNum } from '../lib/format.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

export const sharedExerciseName = entry => entry.name && entry.name !== entry.id ? entry.name
  : EXIDX[entry.id] ? exerciseNameFor(EXIDX[entry.id]) : entry.id

function setText(set, unit) {
  const parts = []
  if (set.side) parts.push(set.side === 'L' ? t('Left') : t('Right'))
  if (set.w != null) parts.push(fmtNum(set.w) + ' ' + unit)
  if (set.r != null) parts.push(fmtNum(set.r) + ' ' + t('reps'))
  if (set.min != null) parts.push(fmtNum(set.min) + ' min')
  if (set.sec != null) parts.push(fmtNum(set.sec) + ' s')
  return parts.join(' · ') || t('Completed set')
}

export default function SharedWorkoutCard({ workout, owner, onClick, detail = false }) {
  const sets = workout.entries.reduce((n, entry) => n + entry.sets.length, 0)
  const summary = [workout.date ? fmtDate(workout.date, true) : null,
    workout.durationMs != null ? fmtDur(workout.durationMs) : null,
    t('{0} completed sets', sets)].filter(Boolean).join(' · ')
  const content = <>
    <span className="lrow-i" style={{ background: 'var(--acc)' }}><Icon name="dumbbell" /></span>
    <div className="grow"><div className="tt">{workout.title || t('Workout')}</div>
      <div className="ss">{owner ? owner.name + ' · ' : ''}{summary}</div></div>
    {!detail && <Icon name="chevronRight" className="chev" />}
  </>
  return detail ? <div className="card shared-workout-detail">
    <div className="row">{content}</div>
    {workout.entries.length ? workout.entries.map((entry, i) => <div className="shared-exercise" key={entry.id + '-' + i}>
      <div className="tt">{sharedExerciseName(entry)}</div>
      {entry.sets.map((set, j) => <div className="small muted" key={j}>{j + 1}. {setText(set, workout.unit)}</div>)}
    </div>) : <div className="small muted" style={{ marginTop: 12 }}>{t('No completed sets in this workout.')}</div>}
    {workout.truncated && <div className="small muted">{t('This workout is long; only its first 100 exercises and 200 sets per exercise are shown.')}</div>}
  </div> : <button className="item shared-workout-row" onClick={onClick}>{content}</button>
}

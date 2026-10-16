import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import SharedWorkoutCard, { sharedExerciseName } from '../components/SharedWorkoutCard.jsx'

const errorText = error => error.status === 404 ? t('This friend or shared workout is no longer available.')
  : error.status === 401 ? t('Sign in again to view friends.')
    : !error.status || error.status === 0 ? t('Connection unavailable. Try again when you are online.')
      : t('Something went wrong. Try again.')

export default function FriendProfile() {
  const { id } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = () => {
    setLoading(true); setError(''); setData(null)
    return api('/api/friends/profile?id=' + encodeURIComponent(id))
      .then(setData).catch(e => setError(errorText(e))).finally(() => setLoading(false))
  }
  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setData(null)
    api('/api/friends/profile?id=' + encodeURIComponent(id))
      .then(result => { if (live) setData(result) })
      .catch(e => { if (live) setError(errorText(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [id])
  const workouts = data?.workouts || []
  const weeks = data?.progress?.weeks || []
  const max = Math.max(1, ...weeks.map(w => w.count))
  const unit = workouts[0]?.unit || 'kg'
  return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/friends')} aria-label={t('Friends')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{data?.user.name || t('Friend profile')}</h1><div className="sub">{t('Shared progress')}</div></div>
      <button className="iconbtn" onClick={load} disabled={loading} aria-label={t('Refresh shared progress')}><Icon name="reset" /></button>
    </div>
    {loading ? <div className="empty" role="status">{t('Loading shared workouts…')}</div> : error ? <div className="card friend-feedback" role="alert">{error}</div> : data && <>
      <div className="card"><h2>{t('Activity in the last 8 weeks')}</h2>
        <div className="shared-week-chart" role="img" aria-label={t('Shared workouts by week') + ': ' + weeks.map(w => t('{0} shared workouts in the week of {1}', w.count, w.start)).join(', ')}>
          {weeks.map(week => <div className="shared-week" key={week.start} title={t('{0} shared workouts in the week of {1}', week.count, week.start)}>
            <span className="small">{week.count}</span>
            <span className="shared-week-bar" style={{ height: 8 + week.count / max * 58 }} />
            <span className="small muted">{week.start.slice(5)}</span>
          </div>)}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>{t('Only shared workouts count toward these figures.')}</div>
      </div>
      <div className="card"><h2>{t('Performance in shared workouts')}</h2>
        {data.progress.exercises.length ? <div className="list">{data.progress.exercises.map(ex => <div className="shared-progress-row" key={ex.id}>
          <div className="tt">{sharedExerciseName(ex)}</div>
          <div className="small muted">{fmtNum(ex.first)} → {fmtNum(ex.latest)} {unit} · {t('Best: {0} {1}', fmtNum(ex.best), unit)}</div>
        </div>)}</div> : <div className="small muted">{t('No shared weight records yet.')}</div>}
      </div>
      <section className="sect"><span className="sect-t">{t('Shared workouts')} · {workouts.length}</span>
        {workouts.length ? <div className="list">{workouts.map(w => <SharedWorkoutCard key={w.id} workout={w} onClick={() => nav('/friends/' + encodeURIComponent(id) + '/workout/' + encodeURIComponent(w.id))} />)}</div>
          : <div className="card muted small">{t('This friend has not shared a workout yet.')}</div>}
      </section>
      <div className="small muted">{t('The list and progress use up to 100 recently shared workouts. Private workouts are never counted.')}</div>
    </>}
  </div>
}

export function SharedWorkoutView() {
  const { id, workoutId } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setData(null)
    api('/api/friends/workout?ownerId=' + encodeURIComponent(id) + '&workoutId=' + encodeURIComponent(workoutId))
      .then(result => { if (live) setData(result) })
      .catch(e => { if (live) setError(errorText(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [id, workoutId])
  return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/friends/' + encodeURIComponent(id))} aria-label={t('Friend profile')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Shared workout')}</h1><div className="sub">{data?.owner.name || ''}</div></div></div>
    {loading ? <div className="empty" role="status">{t('Loading shared workouts…')}</div> : error ? <div className="card friend-feedback" role="alert">{error}</div>
      : data && <><SharedWorkoutCard workout={data.workout} owner={data.owner} detail />
        <div className="small muted">{t('This is the current shared version. The owner can edit or remove it at any time.')}</div></>}
  </div>
}

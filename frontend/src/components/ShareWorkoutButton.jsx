import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { legacySyncKey } from '../lib/workout-date.js'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { Button } from './ui.jsx'

const workoutIdOf = w => typeof w?.id === 'string' && w.id ? w.id
  : typeof w?.d === 'string' && typeof w?.start === 'number' ? legacySyncKey(w) : null
const socialError = error => !error?.status || error.status === 0
  ? t('Connection unavailable. Try again when you are online.')
  : error.status === 404 ? t('Sync this workout before sharing it.')
    : t('Could not change this share. Try again.')

export default function ShareWorkoutButton({ workout, confirm }) {
  const user = useStore(s => s.user)
  const [published, setPublished] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const id = workoutIdOf(workout)
  useEffect(() => {
    if (!user || !id) { setLoading(false); return }
    let live = true
    setLoading(true); setPublished(false); setError(''); setNotice('')
    api('/api/shares').then(data => { if (live) setPublished(data.shares.some(s => s.workoutId === id)) })
      .catch(e => { if (live) setError(socialError(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [user?.id, id])
  if (!user || !id) return null

  const change = async next => {
    setBusy(true); setError(''); setNotice('')
    try {
      if (next) {
        const sync = await useStore.getState().syncNow()
        if (sync?.status !== 'ok') throw Object.assign(new Error('sync pending'), { code: 'sync-pending' })
      }
      await api('/api/shares/' + (next ? 'publish' : 'revoke'), { method: 'POST', body: JSON.stringify({ workoutId: id }) })
      setPublished(next)
      setNotice(next ? t('Workout shared with friends.') : t('Workout share removed.'))
    } catch (e) {
      if (!next && e.status === 404) { setPublished(false); setNotice(t('Workout share removed.')) }
      else setError(e.code === 'sync-pending' ? t('Sync this workout before sharing it.') : socialError(e))
    } finally { setBusy(false) }
  }
  const ask = () => confirm(published ? {
    title: t('Remove this workout from friends?'),
    message: t('Friends will lose access to it immediately.'),
    confirmText: t('Remove share'), danger: true, onConfirm: () => change(false)
  } : {
    title: t('Share this workout with friends?'),
    message: t('Your current and future friends can see its title, date, exercises, completed sets, weights, reps and duration. Notes, body weight and media stay private. Edits appear in the shared view; deleting the workout removes it.'),
    confirmText: t('Share workout'), onConfirm: () => change(true)
  })
  return <div className="workout-share-control">
    <Button icon="friends" variant={published ? 'ghost' : 'tinted'} disabled={loading || busy} onClick={ask}>
      {loading ? t('Checking share…') : busy ? t('Saving…') : published ? t('Remove share') : t('Share with friends')}
    </Button>
    {published && <div className="small muted">{t('Visible to accepted friends')}</div>}
    {notice && <div className="small accent" role="status">{notice}</div>}
    {error && <div className="small" role="alert" style={{ color: 'var(--red)' }}>{error}</div>}
  </div>
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { confirmSheet } from '../sheets.jsx'
import { Button, TextField } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const post = (path, body) => api('/api/friends/' + path, { method: 'POST', body: JSON.stringify(body) })

function messageFor(error) {
  if (error.status === 401) return t('Sign in again to manage friends.')
  if (error.status === 429) return t('Too many attempts. Try again in a minute.')
  if (error.data?.code === 'ambiguous') return t('Several people use this name. Ask for their friend code.')
  if (error.data?.code === 'incoming-request') return t('This person has already invited you. Accept their request below.')
  if (error.status === 404) return t('No profile found. Check the exact name or friend code.')
  if (!error.status || error.status === 0) return t('Connection unavailable. Try again when you are online.')
  return t('Something went wrong. Try again.')
}

export default function Friends() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const [data, setData] = useState(null)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    const next = await api('/api/friends')
    setData(next)
    setFound(prev => prev ? { ...prev, relationship: next.relationships.find(r => r.user.id === prev.user.id) || null } : null)
  }
  useEffect(() => {
    if (!user) { setLoading(false); return }
    let live = true
    api('/api/friends').then(next => { if (live) setData(next) }).catch(e => { if (live) setError(messageFor(e)) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [user?.id])

  const search = async e => {
    e.preventDefault()
    if (!query.trim()) return
    setError(''); setNotice(''); setFound(null); setSearching(true)
    try { setFound(await post('lookup', { query: query.trim() })) }
    catch (e) { setError(messageFor(e)) }
    finally { setSearching(false) }
  }
  const act = async (action, relationship, targetId) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await post(action, action === 'request' ? { targetId } : { id: relationship.id })
      await load()
      setNotice({ request: t('Request sent.'), accept: t('Friend added.'), decline: t('Request declined.'), cancel: t('Request cancelled.'), remove: t('Friend removed.') }[action])
    } catch (e) {
      setError(messageFor(e))
      // A crossed request or a changed relationship should be visible on the next attempt.
      if (e.status === 409 || e.status === 404) load().catch(() => {})
    } finally { setBusy(false) }
  }
  const remove = row => confirmSheet({
    title: t('Remove {0} from friends?', row.user.name),
    message: t('You will both lose access to anything shared with friends.'),
    confirmText: t('Remove friend'), danger: true,
    onConfirm: () => act('remove', row)
  })
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(data.code); setNotice(t('Friend code copied.')); setError('') }
    catch { setError(t('Could not copy the code. Select it and copy it manually.')) }
  }
  const refresh = async () => {
    setLoading(true); setError(''); setNotice('')
    try { await load() } catch (e) { setError(messageFor(e)) }
    finally { setLoading(false) }
  }
  const relationships = data?.relationships || []
  const friends = relationships.filter(r => r.status === 'accepted')
  const incoming = relationships.filter(r => r.status === 'pending' && r.direction === 'incoming')
  const outgoing = relationships.filter(r => r.status === 'pending' && r.direction === 'outgoing')

  const row = (person, relationship, result = false) => <div className="item friend-row" key={result ? 'result' : relationship.id}>
    <span className="lrow-i"><Icon name="person" /></span>
    <div className="grow"><div className="tt">{person.name}</div>
      <div className="ss">{!relationship ? t('No request yet') : relationship.status === 'accepted' ? t('Friend') : relationship.direction === 'incoming' ? t('Wants to add you') : t('Request pending')}</div>
    </div>
    <div className="friend-actions">
      {!relationship && <Button size="xs" variant="tinted" disabled={busy} onClick={() => act('request', null, person.id)}>{t('Add')}</Button>}
      {relationship?.status === 'pending' && relationship.direction === 'incoming' && <>
        <Button size="xs" variant="tinted" disabled={busy} onClick={() => act('accept', relationship)}>{t('Accept')}</Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => act('decline', relationship)}>{t('Decline')}</Button>
      </>}
      {relationship?.status === 'pending' && relationship.direction === 'outgoing' && <Button size="xs" variant="ghost" disabled={busy} onClick={() => act('cancel', relationship)}>{t('Cancel')}</Button>}
      {relationship?.status === 'accepted' && <Button size="xs" variant="ghost" disabled={busy} onClick={() => remove(relationship)}>{t('Remove')}</Button>}
    </div>
  </div>

  return <div className="narrow friends-view">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Friends')}</h1><div className="sub">{t('Requests and accepted friends')}</div></div>
      {user && <button className="iconbtn" onClick={refresh} disabled={loading || busy} aria-label={t('Refresh friends')}><Icon name="reset" /></button>}
    </div>
    {!user ? <div className="empty">{t('Sign in to add friends. Guest workouts stay on this device.')}</div> : <>
      {error && <div className="card friend-feedback" role="alert">{error} <Button size="xs" variant="ghost" onClick={refresh}>{t('Retry')}</Button></div>}
      {notice && <div className="card friend-feedback" role="status">{notice}</div>}
      {loading ? <div className="empty" role="status">{t('Loading friends…')}</div> : data && <>
        <div className="card"><h2>{t('Add a friend')}</h2>
          <form className="friend-search" onSubmit={search}>
            <TextField value={query} onChange={e => setQuery(e.target.value)} maxLength={80} autoComplete="off" aria-label={t('Exact name or friend code')} placeholder={t('Exact name or friend code')} />
            <Button variant="primary" type="submit" disabled={searching || busy || !query.trim()}>{searching ? t('Searching…') : t('Find')}</Button>
          </form>
          <div className="small muted" style={{ marginTop: 10 }}>{t('Search by exact name or code. Other accounts are not listed.')}</div>
          {found && <div className="friend-result">{row(found.user, found.relationship, true)}</div>}
        </div>
        <div className="card"><h2>{t('Your friend code')}</h2><div className="friend-code"><code>{data.code}</code><Button size="sm" variant="tinted" onClick={copyCode}>{t('Copy code')}</Button></div></div>
        <section className="sect"><span className="sect-t">{t('Requests received')} · {incoming.length}</span>
          {incoming.length ? <div className="list">{incoming.map(r => row(r.user, r))}</div> : <div className="card muted small">{t('No requests received.')}</div>}</section>
        <section className="sect"><span className="sect-t">{t('Requests sent')} · {outgoing.length}</span>
          {outgoing.length ? <div className="list">{outgoing.map(r => row(r.user, r))}</div> : <div className="card muted small">{t('No requests sent.')}</div>}</section>
        <section className="sect"><span className="sect-t">{t('Friends')} · {friends.length}</span>
          {friends.length ? <div className="list">{friends.map(r => row(r.user, r))}</div> : <div className="card muted small">{t('No friends yet. Search for someone above.')}</div>}</section>
      </>}
    </>}
  </div>
}

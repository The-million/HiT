// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({
  api: vi.fn(), syncNow: vi.fn(), confirm: vi.fn(), user: { id: 'owner' }
}))
vi.mock('../lib/api.js', () => ({ api: (...args) => mocks.api(...args) }))
vi.mock('../lib/i18n.js', () => ({ t: value => value }))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector({ user: mocks.user })
  useStore.getState = () => ({ syncNow: mocks.syncNow })
  return { useStore }
})

import ShareWorkoutButton from './ShareWorkoutButton.jsx'

let host, root
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const button = label => [...host.querySelectorAll('button')].find(el => el.textContent === label)
beforeEach(() => {
  mocks.api.mockReset(); mocks.syncNow.mockReset(); mocks.confirm.mockReset()
  mocks.api.mockImplementation(async path => path === '/api/shares' ? { shares: [] } : { ok: true })
  mocks.syncNow.mockResolvedValue({ status: 'ok' })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

it('publishes a single saved workout only after confirmation and successful sync, then revokes it', async () => {
  act(() => root.render(<ShareWorkoutButton workout={{ id: 'w1' }} confirm={mocks.confirm} />))
  await settle()
  expect(button('Share with friends')).toBeTruthy()
  await act(async () => { button('Share with friends').click() })
  expect(mocks.api).not.toHaveBeenCalledWith('/api/shares/publish', expect.anything())
  expect(mocks.confirm.mock.calls[0][0].message).toContain('Notes, body weight and media stay private')
  await act(async () => { await mocks.confirm.mock.calls[0][0].onConfirm() })
  expect(mocks.syncNow).toHaveBeenCalledOnce()
  expect(mocks.api).toHaveBeenCalledWith('/api/shares/publish', { method: 'POST', body: JSON.stringify({ workoutId: 'w1' }) })
  expect(button('Remove share')).toBeTruthy()
  await act(async () => { button('Remove share').click() })
  await act(async () => { await mocks.confirm.mock.calls[1][0].onConfirm() })
  expect(mocks.api).toHaveBeenCalledWith('/api/shares/revoke', { method: 'POST', body: JSON.stringify({ workoutId: 'w1' }) })
  expect(button('Share with friends')).toBeTruthy()
})

it('keeps a workout private when synchronization is not complete', async () => {
  mocks.syncNow.mockResolvedValue({ status: 'offline' })
  act(() => root.render(<ShareWorkoutButton workout={{ id: 'w1' }} confirm={mocks.confirm} />))
  await settle()
  await act(async () => { button('Share with friends').click() })
  await act(async () => { await mocks.confirm.mock.calls[0][0].onConfirm() })
  expect(mocks.api).not.toHaveBeenCalledWith('/api/shares/publish', expect.anything())
  expect(host.textContent).toContain('Sync this workout before sharing it.')
})

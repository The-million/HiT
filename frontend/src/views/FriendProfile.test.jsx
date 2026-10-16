// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ api: vi.fn(), nav: vi.fn(), params: { id: 'friend', workoutId: 'w1' } }))
vi.mock('../lib/api.js', () => ({ api: (...args) => mocks.api(...args) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav, useParams: () => mocks.params }))

import FriendProfile, { SharedWorkoutView } from './FriendProfile.jsx'

let host, root
const workout = { id: 'w1', title: 'Push day', date: '2026-10-16', durationMs: 60000, unit: 'kg',
  entries: [{ id: 'custom1', name: 'Demo lift', sets: [{ w: 45, r: 8 }] }] }
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
beforeEach(() => {
  mocks.api.mockReset(); mocks.nav.mockReset()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

it('shows progress derived from shared workouts and opens a shared session', async () => {
  mocks.api.mockResolvedValue({ user: { id: 'friend', name: 'Friend' }, workouts: [workout], progress: {
    weeks: [{ start: '2026-10-12', count: 1 }],
    exercises: [{ id: 'custom1', name: 'Demo lift', first: 40, latest: 45, best: 45, sessions: 2 }]
  } })
  act(() => root.render(<FriendProfile />))
  await settle()
  expect(mocks.api).toHaveBeenCalledWith('/api/friends/profile?id=friend')
  expect(host.textContent).toContain('Friend')
  expect(host.textContent).toContain('Demo lift')
  expect(host.textContent).toContain('40 → 45')
  expect(host.querySelector('.shared-week-chart').getAttribute('aria-label')).toContain('1 shared workouts')
  await act(async () => { [...host.querySelectorAll('button')].find(el => el.textContent.includes('Push day')).click() })
  expect(mocks.nav).toHaveBeenCalledWith('/friends/friend/workout/w1')
})

it('reads the direct authorized workout view and handles revoked access', async () => {
  mocks.api.mockResolvedValueOnce({ owner: { id: 'friend', name: 'Friend' }, workout })
  act(() => root.render(<SharedWorkoutView />))
  await settle()
  expect(mocks.api).toHaveBeenCalledWith('/api/friends/workout?ownerId=friend&workoutId=w1')
  expect(host.textContent).toContain('45 kg')
  act(() => root.unmount())
  root = createRoot(host)
  mocks.api.mockRejectedValueOnce({ status: 404 })
  act(() => root.render(<SharedWorkoutView />))
  await settle()
  expect(host.textContent).toContain('no longer available')
})

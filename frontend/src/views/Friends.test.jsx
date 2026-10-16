// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  api: vi.fn(), nav: vi.fn(), confirm: vi.fn(), user: { id: 'owner', name: 'Owner' }
}))
vi.mock('../lib/api.js', () => ({ api: (...args) => mocks.api(...args) }))
vi.mock('../lib/i18n.js', () => ({ t: (value, ...args) => value.replace(/\{(\d+)\}/g, (_, n) => args[n]) }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ user: mocks.user }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: (...args) => mocks.confirm(...args) }))

import Friends from './Friends.jsx'

let host, root, rows, feedWorkouts
const person = (id, name) => ({ id, name })
const relation = (id, name, status, direction) => ({ id: 'r-' + id, user: person(id, name), status, direction, created: '2026-10-16' })
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const button = label => [...host.querySelectorAll('button')].find(el => el.textContent === label)
const tap = el => act(async () => { el.click(); await new Promise(resolve => setTimeout(resolve, 0)) })

beforeEach(() => {
  rows = [relation('alice', 'Alice', 'pending', 'incoming'), relation('bob', 'Bob', 'pending', 'outgoing'), relation('cara', 'Cara', 'accepted', 'outgoing')]
  feedWorkouts = []
  mocks.api.mockReset(); mocks.nav.mockReset(); mocks.confirm.mockReset()
  mocks.api.mockImplementation(async (path, opts) => {
    if (path === '/api/friends' && !opts) return { code: 'owner', relationships: rows }
    if (path === '/api/friends/feed') return { workouts: feedWorkouts }
    if (path === '/api/friends/lookup') return { user: person('dave', 'Dave'), relationship: null }
    if (path === '/api/friends/request') {
      rows = [...rows, relation('dave', 'Dave', 'pending', 'outgoing')]
      return { relationship: rows.at(-1) }
    }
    if (path === '/api/friends/accept') {
      rows = rows.map(row => row.id === 'r-alice' ? { ...row, status: 'accepted' } : row)
      return { relationship: rows[0] }
    }
    throw new Error('unexpected ' + path)
  })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

it('shows current friends and requests, then sends an exact lookup request', async () => {
  act(() => root.render(<Friends />))
  await settle()
  expect(host.textContent).toContain('Requests received · 1')
  expect(host.textContent).toContain('Requests sent · 1')
  expect(host.textContent).toContain('Friends · 1')
  expect(host.textContent).toContain('Alice')

  const input = host.querySelector('input[aria-label="Exact name or friend code"]')
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Dave')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await tap(button('Find'))
  expect(mocks.api).toHaveBeenCalledWith('/api/friends/lookup', { method: 'POST', body: JSON.stringify({ query: 'Dave' }) })
  expect(host.textContent).toContain('Dave')
  await tap(button('Add'))
  expect(mocks.api).toHaveBeenCalledWith('/api/friends/request', { method: 'POST', body: JSON.stringify({ targetId: 'dave' }) })
  expect(host.textContent).toContain('Requests sent · 2')
})

it('accepts only from the received row and asks before removing a friend', async () => {
  act(() => root.render(<Friends />))
  await settle()
  await tap(button('Accept'))
  expect(mocks.api).toHaveBeenCalledWith('/api/friends/accept', { method: 'POST', body: JSON.stringify({ id: 'r-alice' }) })
  expect(host.textContent).toContain('Friends · 2')
  await tap(button('Remove'))
  expect(mocks.confirm).toHaveBeenCalledOnce()
  expect(mocks.confirm.mock.calls[0][0].confirmText).toBe('Remove friend')
})

it('opens a friend profile and one of their published workouts from the existing friends page', async () => {
  feedWorkouts = [{ id: 'w1', title: 'Push day', date: '2026-10-16', durationMs: 60000, unit: 'kg', entries: [], owner: person('cara', 'Cara') }]
  act(() => root.render(<Friends />))
  await settle()
  expect(host.textContent).toContain('Shared workouts from friends')
  expect(host.textContent).toContain('Push day')
  await tap(button('View'))
  expect(mocks.nav).toHaveBeenCalledWith('/friends/cara')
  await tap([...host.querySelectorAll('button')].find(el => el.textContent.includes('Push day')))
  expect(mocks.nav).toHaveBeenCalledWith('/friends/cara/workout/w1')
})

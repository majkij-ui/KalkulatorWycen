import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wonEventToAdd, type WonEventLookup } from './won-event'
import type { ProjectStatus } from './project-types'

const TODAY = '2026-11-01'
const project = (status: ProjectStatus) => ({ id: 'p-1', status })
const won = (extra: Partial<WonEventLookup> = {}): WonEventLookup => ({ kind: 'won', projectId: 'p-1', ...extra })

const NEW_EVENT = { kind: 'won', projectId: 'p-1', start: TODAY, title: '', data: {} }

test('wycena → W realizacji bez wydarzenia won: nowe won z dzisiejszą datą (sama data)', () => {
  const draft = wonEventToAdd(project('quote'), [], 'won', TODAY)
  assert.deepEqual(draft, NEW_EVENT)
  assert.match(draft!.start, /^\d{4}-\d{2}-\d{2}$/)
})

test('nieprzyjęty → W realizacji bez won: to samo (klient wrócił)', () => {
  assert.deepEqual(wonEventToAdd(project('lost'), [], 'won', TODAY), NEW_EVENT)
})

test('żywe won istnieje: nic nowego, niezależnie od poprzedniego statusu', () => {
  for (const from of ['quote', 'lost', 'done'] as const) {
    assert.equal(wonEventToAdd(project(from), [won()], 'won', TODAY), null)
  }
})

test('jedyne won jest usunięte miękko: dopisujemy nowe', () => {
  assert.deepEqual(wonEventToAdd(project('quote'), [won({ deletedAt: '2026-10-20T10:00:00.000Z' })], 'won', TODAY), NEW_EVENT)
})

test('won innego projektu albo inny typ wydarzenia nie liczy się', () => {
  const events: WonEventLookup[] = [
    { kind: 'won', projectId: 'p-2' },
    { kind: 'quote_sent', projectId: 'p-1' },
    { kind: 'won', projectId: null },
  ]
  assert.deepEqual(wonEventToAdd(project('quote'), events, 'won', TODAY), NEW_EVENT)
})

test('już W realizacji → W realizacji: nic (także bez won w wątku)', () => {
  assert.equal(wonEventToAdd(project('won'), [], 'won', TODAY), null)
})

test('→ Zrealizowany (także prosto z wyceny): nic', () => {
  assert.equal(wonEventToAdd(project('quote'), [], 'done', TODAY), null)
  assert.equal(wonEventToAdd(project('won'), [], 'done', TODAY), null)
})

test('→ Wycena albo Nieprzyjęty z W realizacji: nic, a istniejące won zostaje (helper go nie dotyka)', () => {
  const events = [won()]
  assert.equal(wonEventToAdd(project('won'), events, 'quote', TODAY), null)
  assert.equal(wonEventToAdd(project('won'), events, 'lost', TODAY), null)
  assert.equal(events.length, 1)
})

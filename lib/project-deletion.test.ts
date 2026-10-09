import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deletionNote, eventsDeletedWithProject, planProjectDeletion } from './project-deletion'

const AT = '2026-10-09T10:00:00.000Z'
const EARLIER = '2026-10-01T08:00:00.000Z'

const EVENTS = [
  { id: 'lead', kind: 'lead_in', projectId: 'p-1' },
  { id: 'shoot', kind: 'shoot_day', projectId: 'p-1' },
  { id: 'gone', kind: 'note', projectId: 'p-1', deletedAt: EARLIER },
  { id: 'other', kind: 'shoot_day', projectId: 'p-2' },
  { id: 'gear', kind: 'gear_purchase', projectId: null },
]

test('plan usunięcia obejmuje tylko aktywne wydarzenia tego projektu i liczy leady', () => {
  assert.deepEqual(planProjectDeletion(EVENTS, 'p-1'), { eventIds: ['lead', 'shoot'], leadCount: 1 })
  assert.deepEqual(planProjectDeletion(EVENTS, 'p-3'), { eventIds: [], leadCount: 0 })
})

test('cofnięcie przywraca tylko to, co zniknęło razem z projektem', () => {
  const afterDelete = EVENTS.map((e) => (['lead', 'shoot'].includes(e.id) ? { ...e, deletedAt: AT } : e))
  assert.deepEqual(eventsDeletedWithProject(afterDelete, { id: 'p-1', deletedAt: AT }), ['lead', 'shoot'])
  // Projekt nieusunięty — nie ma czego przywracać.
  assert.deepEqual(eventsDeletedWithProject(afterDelete, { id: 'p-1' }), [])
  // Ten sam znacznik u innego projektu niczego nie przywraca.
  assert.deepEqual(eventsDeletedWithProject(afterDelete, { id: 'p-2', deletedAt: AT }), [])
})

test('dopisek do potwierdzenia z polską odmianą', () => {
  assert.equal(deletionNote({ eventIds: [], leadCount: 0 }), null)
  assert.equal(deletionNote({ eventIds: ['a'], leadCount: 0 }), 'Usunie też 1 wydarzenie.')
  assert.equal(deletionNote({ eventIds: ['a', 'b', 'c'], leadCount: 1 }), 'Usunie też 3 wydarzenia (w tym 1 lead).')
  assert.equal(
    deletionNote({ eventIds: ['a', 'b', 'c', 'd', 'e', 'f'], leadCount: 2 }),
    'Usunie też 6 wydarzeń (w tym 2 leady).'
  )
})

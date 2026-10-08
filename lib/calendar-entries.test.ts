import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCalendarEntries, gearItemIdOf, monthSummary } from './calendar-entries'
import { eventSchema, type TimelineEvent } from './event-types'
import type { EquipmentItem } from './project-types'

const ev = (id: string, kind: string, start: string, extra: Record<string, unknown> = {}): TimelineEvent =>
  eventSchema.parse({ id, kind, projectId: 'p-1', start, ...extra })

const gear = (id: string, purchaseDate: string, purchasePrice = 0): EquipmentItem => ({
  id,
  name: `Sprzęt ${id}`,
  category: 'inne',
  purchasePrice,
  rentalDayRate: 0,
  purchaseDate,
  notes: '',
})

test('kalendarz pokazuje wydarzenia i zakupy z katalogu, chronologicznie', () => {
  const entries = buildCalendarEntries(
    [ev('e2', 'shoot_day', '2026-10-14'), ev('e1', 'lead_in', '2026-10-02T09:14')],
    [gear('g1', '2026-10-08', 4500), gear('g2', '')]
  )
  assert.deepEqual(
    entries.map((e) => [e.kind, e.origin]),
    [
      ['lead_in', 'event'],
      ['gear_purchase', 'gear'],
      ['shoot_day', 'event'],
    ]
  )
  const projected = entries[1]
  assert.equal(projected.projectId, null)
  assert.equal(projected.title, 'Sprzęt g1')
  assert.equal(gearItemIdOf(projected), 'g1')
  assert.equal(gearItemIdOf(entries[0]), null)
})

test('usunięte i bez daty nie trafiają do kalendarza', () => {
  const entries = buildCalendarEntries(
    [ev('e1', 'note', '2026-10-02', { deletedAt: '2026-10-03T00:00:00Z' }), ev('e2', 'note', 'zła data')],
    []
  )
  assert.equal(entries.length, 0)
})

test('zakup zapisany też jako wydarzenie nie dubluje się — wygrywa katalog', () => {
  const entries = buildCalendarEntries(
    [ev('e1', 'gear_purchase', '2026-10-08', { projectId: null, data: { itemId: 'g1' } })],
    [gear('g1', '2026-10-08')]
  )
  assert.equal(entries.length, 1)
  assert.equal(entries[0].origin, 'gear')
})

test('podsumowanie miesiąca liczy tylko ten miesiąc, dni tego samego projektu raz', () => {
  const entries = buildCalendarEntries(
    [
      ev('l1', 'lead_in', '2026-10-02'),
      ev('l2', 'lead_in', '2026-09-30'),
      ev('s1', 'shoot_day', '2026-10-30', { end: '2026-11-02' }),
      ev('s2', 'shoot_day', '2026-10-31'),
      ev('s3', 'shoot_day', '2026-10-31', { projectId: 'p-2' }),
      ev('p1', 'post_day', '2026-09-28', { end: '2026-10-03' }),
      ev('i1', 'invoice_sent', '2026-10-16'),
      ev('i2', 'invoice_paid', '2026-10-03'),
    ],
    [gear('g1', '2026-10-08', 4500), gear('g2', '2026-10-22', 7200), gear('g3', '2026-11-01', 999)]
  )
  assert.deepEqual(monthSummary(entries, 2026, 10), {
    leads: 1,
    shootDays: 3,
    postDays: 3,
    invoicesSent: 1,
    invoicesPaid: 1,
    gearCount: 2,
    gearSpend: 11700,
  })
})

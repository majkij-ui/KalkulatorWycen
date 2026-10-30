/**
 * Finanse V2: podsumowanie nad kaflami (projekty · klienci · dni zdjęciowe),
 * „czeka na wpłatę" i „po terminie".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClientGroup } from './client-groups'
import type { Period } from './finance-calc'
import { activityLabel, overdueAwaiting, periodActivity, periodPayments } from './finance-summary'
import type { OpenInvoice } from './money-loop'

const OCT: Period = { kind: 'month', year: 2026, index: 10 }
const YEAR: Period = { kind: 'year', year: 2026, index: 1 }

const project = (id: string, client: string) => ({ id, client })
const shoot = (projectId: string, start: string, end?: string, extra: Record<string, unknown> = {}) =>
  ({ kind: 'shoot_day', projectId, start, end, ...extra }) as never

test('dni zdjęciowe: wydarzenie wielodniowe liczy tylko dni w okresie', () => {
  const input = {
    projectIds: ['p1'],
    projects: [project('p1', 'Alfa')],
    // 30 IX – 2 X: w październiku tylko 1 i 2 X
    events: [shoot('p1', '2026-09-30', '2026-10-02')],
    groups: [],
  }
  assert.equal(periodActivity({ ...input, period: OCT }).shootDays, 2)
  assert.equal(periodActivity({ ...input, period: YEAR }).shootDays, 3)
})

test('dni zdjęciowe: usunięte wydarzenie, dzień przygotowawczy i cudzy projekt nie liczą się', () => {
  const result = periodActivity({
    projectIds: ['p1'],
    projects: [project('p1', 'Alfa'), project('p2', 'Beta')],
    events: [
      shoot('p1', '2026-10-05'),
      shoot('p1', '2026-10-06', undefined, { deletedAt: '2026-10-07T10:00:00.000Z' }),
      { kind: 'prep_day', projectId: 'p1', start: '2026-10-07' } as never,
      shoot('p2', '2026-10-08'),
    ],
    groups: [],
    period: OCT,
  })
  assert.equal(result.shootDays, 1)
})

test('przegrany projekt (poza liczonymi) nie wchodzi ani do projektów, ani do klientów, ani do dni', () => {
  const result = periodActivity({
    projectIds: ['p1'],
    projects: [project('p1', 'Alfa'), project('lost', 'Beta')],
    events: [shoot('lost', '2026-10-08'), shoot('p1', '2026-10-09')],
    groups: [],
    period: OCT,
  })
  assert.deepEqual(result, { projects: 1, clients: 1, shootDays: 1 })
})

test('klienci: grupa to jeden klient, ten sam klient w dwóch projektach liczy się raz, bez klienta nie liczy się', () => {
  const { groups } = createClientGroup([], { name: 'Hotele', members: ['Interferie S.A.', 'Sun & Snow'] }, '2026-10-01T00:00:00.000Z')
  const result = periodActivity({
    projectIds: ['a', 'b', 'c', 'd', 'e'],
    projects: [
      project('a', 'Interferie S.A.'),
      project('b', 'Sun & Snow'),
      project('c', 'Alfa'),
      project('d', 'alfa'),
      project('e', ''),
    ],
    events: [],
    groups,
    period: YEAR,
  })
  assert.deepEqual(result, { projects: 5, clients: 2, shootDays: 0 })
})

test('etykieta: polskie liczby mnogie', () => {
  assert.equal(activityLabel({ projects: 1, clients: 1, shootDays: 1 }), '1 projekt · 1 klient · 1 dzień zdjęciowy')
  assert.equal(activityLabel({ projects: 3, clients: 2, shootDays: 4 }), '3 projekty · 2 klientów · 4 dni zdjęciowe')
  assert.equal(activityLabel({ projects: 12, clients: 5, shootDays: 0 }), '12 projektów · 5 klientów · 0 dni zdjęciowych')
  assert.equal(activityLabel({ projects: 22, clients: 13, shootDays: 22 }), '22 projekty · 13 klientów · 22 dni zdjęciowe')
})

test('czeka na wpłatę: kawałki okresu, wpłynęło osobno', () => {
  const rows = [
    {
      money: {
        pieces: [
          { day: '2026-10-03', amount: 1000, source: 'invoice', paid: true },
          { day: '2026-10-20', amount: 500, source: 'invoice', paid: false },
          { day: '2026-11-02', amount: 700, source: 'plan', paid: false },
        ],
      },
    },
    { money: { pieces: [{ day: '2026-10-25', amount: 250, source: 'plan', paid: false }] } },
  ] as never[]
  assert.deepEqual(periodPayments(rows, OCT), { paid: 1000, awaiting: 750 })
  assert.deepEqual(periodPayments(rows, YEAR), { paid: 1000, awaiting: 1450 })
})

test('po terminie: tylko otwarte faktury po terminie projektów okresu, wystawione w okresie', () => {
  const invoice = (over: Partial<OpenInvoice>): OpenInvoice => ({
    projectId: 'p1',
    sent: '2026-10-01',
    dueDate: '2026-10-15',
    dueAssumed: false,
    amount: 400,
    daysOpen: 20,
    daysOverdue: 5,
    ...over,
  })
  const open = [
    invoice({}),
    invoice({ amount: 100, daysOverdue: 0 }), // termin dziś — jeszcze nie po terminie
    invoice({ amount: 100, daysOverdue: -3 }),
    invoice({ projectId: 'other', amount: 900 }),
    invoice({ sent: '2026-09-01', amount: 800 }), // wystawiona poza okresem
    invoice({ amount: null }),
  ]
  assert.equal(overdueAwaiting(open, new Set(['p1']), OCT), 400)
  assert.equal(overdueAwaiting(open, new Set(['p1']), YEAR), 1200)
  assert.equal(overdueAwaiting([], new Set(['p1']), OCT), 0)
})

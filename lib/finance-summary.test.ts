/**
 * Finanse V2: podsumowanie nad kaflami (projekty · klienci · dni zdjęciowe),
 * „czeka na wpłatę" i „po terminie".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClientGroup } from './client-groups'
import type { Period } from './finance-calc'
import {
  inProgressInPeriod,
  overdueAwaiting,
  periodActivity,
  periodElapsedMonths,
  periodPayments,
} from './finance-summary'
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

// ── Dni zdjęciowe: kalendarz wygrywa, wycena jako zapas ──────────────────────

const quoted = (id: string, count: number) => ({ id, client: 'Alfa', quote: { data: { dniZdjeciowe: count } } })
const THREE_IN_OCT = [shoot('p', '2026-10-05'), shoot('p', '2026-10-06'), shoot('p', '2026-10-07')]
const shootDaysOf = (projectList: { id: string; client: string; quote?: unknown }[], events: unknown[], period: Period = OCT) =>
  periodActivity({
    projectIds: projectList.map((p) => p.id),
    projects: projectList,
    events: events as never[],
    groups: [],
    period,
  }).shootDays

test('dni zdjęciowe: kalendarz 3 / wycena 3 → 3', () => {
  assert.equal(shootDaysOf([quoted('p', 3)], THREE_IN_OCT), 3)
})

test('dni zdjęciowe: kalendarz 1 / wycena 3 → 1 (kalendarz wygrywa)', () => {
  assert.equal(shootDaysOf([quoted('p', 3)], [shoot('p', '2026-10-05')]), 1)
})

test('dni zdjęciowe: kalendarz 0 / wycena 5 → 5', () => {
  assert.equal(shootDaysOf([quoted('p', 5)], []), 5)
  // usunięty dzień zdjęciowy to nadal „brak wpisów w kalendarzu"
  const deleted = shoot('p', '2026-10-05', undefined, { deletedAt: '2026-10-07T10:00:00.000Z' })
  assert.equal(shootDaysOf([quoted('p', 5)], [deleted]), 5)
})

test('dni zdjęciowe: kalendarz 0 / brak wyceny → 0', () => {
  assert.equal(shootDaysOf([{ id: 'p', client: 'Alfa' }], []), 0)
  assert.equal(shootDaysOf([{ id: 'p', client: 'Alfa', quote: null }], []), 0)
})

test('dni zdjęciowe: dni kalendarza tylko w innym okresie → 0 w tym (bez zapasu z wyceny)', () => {
  const inSeptember = [shoot('p', '2026-09-10'), shoot('p', '2026-09-11')]
  assert.equal(shootDaysOf([quoted('p', 5)], inSeptember, OCT), 0)
  assert.equal(shootDaysOf([quoted('p', 5)], inSeptember, YEAR), 2)
  // dni z innego roku też są „wpisami w kalendarzu"
  assert.equal(shootDaysOf([quoted('p', 5)], [shoot('p', '2025-10-10')], OCT), 0)
})

test('dni zdjęciowe: dzień przygotowawczy nie jest wpisem — wycena zostaje zapasem', () => {
  assert.equal(shootDaysOf([quoted('p', 4)], [{ kind: 'prep_day', projectId: 'p', start: '2026-10-07' }]), 4)
})

test('dni zdjęciowe: reguła jest per projekt — jeden z kalendarza, drugi z wyceny', () => {
  assert.equal(shootDaysOf([quoted('p', 3), quoted('q', 2)], [shoot('p', '2026-10-05')]), 1 + 2)
})

// ── Średnia miesięczna ───────────────────────────────────────────────────────

test('miesiące, które minęły: bieżący rok = pełne miesiące + część bieżącego', () => {
  const elapsed = periodElapsedMonths({ kind: 'year', year: 2026 }, '2026-10-30')
  assert.ok(elapsed !== null && Math.abs(elapsed - (9 + 30 / 31)) < 1e-9)
  assert.ok(Math.abs((periodElapsedMonths({ kind: 'year', year: 2026 }, '2026-01-31') ?? 0) - 1) < 1e-9)
})

test('miesiące, które minęły: zamknięte okresy liczą wszystkie swoje miesiące', () => {
  assert.equal(periodElapsedMonths({ kind: 'year', year: 2025 }, '2026-10-30'), 12)
  assert.equal(periodElapsedMonths({ kind: 'quarter', year: 2026, index: 2 }, '2026-10-30'), 3)
  assert.equal(periodElapsedMonths({ kind: 'half', year: 2026, index: 1 }, '2026-10-30'), 6)
})

test('miesiące, które minęły: widok miesiąca, okres przyszły i trwający krócej niż miesiąc → null', () => {
  assert.equal(periodElapsedMonths({ kind: 'month', year: 2026, index: 10 }, '2026-10-30'), null)
  assert.equal(periodElapsedMonths({ kind: 'month', year: 2025, index: 3 }, '2026-10-30'), null)
  assert.equal(periodElapsedMonths({ kind: 'year', year: 2027 }, '2026-10-30'), null)
  assert.equal(periodElapsedMonths({ kind: 'quarter', year: 2027, index: 1 }, '2026-10-30'), null)
  // Q4 2026 zaczęło się 1 X — 30 X to jeszcze mniej niż miesiąc
  assert.equal(periodElapsedMonths({ kind: 'quarter', year: 2026, index: 4 }, '2026-10-30'), null)
  assert.ok((periodElapsedMonths({ kind: 'quarter', year: 2026, index: 4 }, '2026-11-02') ?? 0) > 1)
})

// ── W realizacji ─────────────────────────────────────────────────────────────

test('w realizacji: tylko projekty „won" okresu i filtra, przychód z okresu', () => {
  const row = (id: string, anchor: string, amount: number) =>
    ({ id, counts: true, anchor, pieces: [{ day: anchor, amount, source: 'plan', paid: false }], taxRatePercent: 8.5 }) as never
  const ledger = [
    row('w1', '2026-10-05', 10_000),
    row('w2', '2026-10-20', 5_000),
    row('d1', '2026-10-06', 3_000), // zakończony — nie „w realizacji"
    row('w3', '2026-02-01', 9_000), // inny miesiąc
  ]
  const status = new Map([
    ['w1', 'won'],
    ['w2', 'won'],
    ['d1', 'done'],
    ['w3', 'won'],
  ])
  assert.deepEqual(inProgressInPeriod(ledger, status, null, OCT), { count: 2, revenue: 15_000 })
  assert.deepEqual(inProgressInPeriod(ledger, status, new Set(['w1', 'd1']), OCT), { count: 1, revenue: 10_000 })
  assert.deepEqual(inProgressInPeriod(ledger, status, null, YEAR), { count: 3, revenue: 24_000 })
  assert.deepEqual(inProgressInPeriod([], status, null, OCT), { count: 0, revenue: 0 })
})

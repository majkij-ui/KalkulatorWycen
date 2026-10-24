/** U1 — dosprzedaż: kategorie (startowe + użyte), fazy, statystyki okresu, dane wydarzenia. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventData } from './event-kinds'
import {
  categoryKey,
  categoryLabel,
  cleanCategory,
  editedExtraSaleData,
  extraSaleCategories,
  extraSaleData,
  extraSaleStats,
  isExtraSalePhase,
  phaseLabel,
} from './extra-sales'
import { projectMoney, type ExtraSale, type MoneyEvent } from './money-loop'

const x = (amount: number | null, extra: Partial<ExtraSale> = {}): ExtraSale => ({ id: `x${amount}`, day: '2026-09-01', what: '', amount, ...extra })
const row = (extras: ExtraSale[], anchored = true) => ({ money: { extras }, anchored })

test('kategorie: trzy startowe, potem użyte (najczęstsze najpierw), bez powtórzeń wielkością liter i spacjami', () => {
  assert.deepEqual(extraSaleCategories([]), ['dodatkowa produkcja', 'dodatkowa postprodukcja', 'surowe materiały'])
  const list = extraSaleCategories([
    x(1, { category: 'Licencja ' }),
    x(2, { category: 'kolor' }),
    x(3, { category: 'licencja' }),
    x(4, { category: '  Surowe   Materiały' }),
    x(5, { category: '' }),
    x(6),
  ])
  assert.deepEqual(list, ['dodatkowa produkcja', 'dodatkowa postprodukcja', 'surowe materiały', 'Licencja', 'kolor'])
  assert.equal(categoryKey('  Surowe   Materiały'), 'surowe materiały')
  assert.equal(cleanCategory('  a   b '), 'a b')
  assert.equal(cleanCategory('   '), undefined)
  assert.equal(categoryLabel(undefined), 'bez kategorii')
})

test('fazy: klucze na stałe, etykiety po polsku, brak = „bez fazy"', () => {
  assert.deepEqual(['before', 'on_set', 'after'].map((p) => phaseLabel(p as never)), ['przed realizacją', 'na planie', 'po projekcie'])
  assert.equal(phaseLabel(undefined), 'bez fazy')
  assert.equal(isExtraSalePhase('on_set'), true)
  assert.equal(isExtraSalePhase('planie'), false)
})

test('statystyki: jak często (projekty z dosprzedażą / zakotwiczone), średnio na projekt, wg kategorii i faz', () => {
  // Real data 2026: 3 z 23 projektów, 4 090 + 3 020 + 1 200 = 8 310 zł, wszystkie bez kategorii.
  const real = extraSaleStats([
    row([x(4090)]),
    row([x(3020)]),
    row([x(1200)]),
    ...Array.from({ length: 20 }, () => row([])),
  ])
  assert.deepEqual([real.projects, real.withExtras, real.count, real.total], [23, 3, 3, 8310])
  assert.ok(Math.abs(real.sharePct! - 13.04) < 0.01)
  assert.equal(real.averagePerProject, 2770)
  assert.deepEqual(real.byCategory.map((g) => [g.label, g.count, g.total]), [['bez kategorii', 3, 8310]])
  assert.deepEqual(real.byPhase.map((g) => [g.label, g.count]), [['bez fazy', 3]])

  const s = extraSaleStats([
    row([x(1000, { category: 'surowe materiały', phase: 'after' }), x(500, { category: 'Surowe materiały', phase: 'on_set' })]),
    row([x(2000, { category: 'dodatkowa produkcja', phase: 'on_set' }), x(null, { category: 'licencja', phase: 'before' })]),
    row([x(300)]),
    row([x(9999)], false), // kotwica w innym okresie — nie liczy się tu
    row([]),
  ])
  assert.deepEqual([s.projects, s.withExtras, s.count, s.total], [4, 3, 5, 3800])
  assert.equal(s.sharePct, 75)
  assert.equal(s.averagePerProject, 3800 / 3)
  assert.deepEqual(
    s.byCategory.map((g) => [g.label, g.count, g.total, g.average]),
    [
      ['dodatkowa produkcja', 1, 2000, 2000],
      ['surowe materiały', 2, 1500, 750],
      ['licencja', 1, 0, null],
      ['bez kategorii', 1, 300, 300],
    ]
  )
  assert.deepEqual(
    s.byPhase.map((g) => [g.label, g.count, g.total]),
    [
      ['przed realizacją', 1, 0],
      ['na planie', 2, 2500],
      ['po projekcie', 1, 1000],
      ['bez fazy', 1, 300],
    ]
  )
})

test('statystyki bez projektów i dosprzedaży bez kwoty', () => {
  const empty = extraSaleStats([])
  assert.deepEqual([empty.projects, empty.sharePct, empty.averagePerProject, empty.byCategory.length], [0, null, null, 0])
  const unpriced = extraSaleStats([row([x(null)]), row([])])
  assert.deepEqual([unpriced.withExtras, unpriced.total, unpriced.averagePerProject, unpriced.sharePct], [1, 0, null, 50])
})

test('dane wydarzenia: puste pola znikają, kwota do grosza; edycja zostawia nieznane pola', () => {
  assert.deepEqual(extraSaleData({ amountNetto: 1200.456, category: '  surowe  materiały ', phase: 'after', what: ' dysk ', number: '' }), {
    amountNetto: 1200.46,
    category: 'surowe materiały',
    phase: 'after',
    what: 'dysk',
  })
  assert.deepEqual(editedExtraSaleData({ what: 'Różnica w kwocie przelewu', amountNetto: 4090, source: 'x', number: 'FV 1' }, { amountNetto: 4090, category: 'dodatkowa produkcja', phase: 'on_set', what: '' }), {
    source: 'x',
    amountNetto: 4090,
    category: 'dodatkowa produkcja',
    phase: 'on_set',
  })
})

test('stare wydarzenie bez kategorii i fazy czyta się bez zmian; pętla pieniędzy niesie kategorię i fazę', () => {
  const old: MoneyEvent = { id: 'e1', kind: 'extra_sale', start: '2026-10-23', projectId: 'p', data: { what: 'Różnica w kwocie przelewu', amountNetto: 4090 } }
  const tagged: MoneyEvent = { id: 'e2', kind: 'extra_sale', start: '2026-10-24', projectId: 'p', data: { amountNetto: 500, category: 'kolor', phase: 'after' } }
  const wrong: MoneyEvent = { id: 'e3', kind: 'extra_sale', start: '2026-10-25', projectId: 'p', data: { amountNetto: 100, phase: 'jutro', future: 1 } }
  assert.equal(eventData(wrong).phase, undefined)
  assert.equal(eventData(wrong).future, 1, 'nieznane pola zostają')
  const money = projectMoney({ id: 'p', status: 'done', date: '2026-10-01', financials: null, costs: [] }, [old, tagged, wrong], '2026-10-26')
  assert.deepEqual(
    money.extras.map((e) => [e.id, e.category ?? null, e.phase ?? null, e.amount]),
    [
      ['e1', null, null, 4090],
      ['e2', 'kolor', 'after', 500],
      ['e3', null, null, 100],
    ]
  )
  assert.equal(money.extrasTotal, 4690)
})

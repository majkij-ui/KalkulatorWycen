import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, daysBetween, hiddenPerDay, layoutWeek, monthGrid } from './calendar-layout'
import { PROJECT_COLOR_KEYS, PROJECT_COLOR_ORDER, nextProjectColor, projectTile, NEUTRAL_TILE } from './calendar-palette'
import { eventKind } from './event-kinds'

test('październik 2026 zaczyna siatkę w poniedziałek 28 września', () => {
  const weeks = monthGrid(2026, 10)
  assert.equal(weeks.length, 5)
  assert.equal(weeks[0][0], '2026-09-28')
  assert.equal(weeks[0][3], '2026-10-01', '1 października to czwartek')
  assert.equal(weeks[4][6], '2026-11-01')
  weeks.forEach((week) => assert.equal(week.length, 7))
})

test('marzec 2026 nie gubi dnia przy zmianie czasu', () => {
  const days = monthGrid(2026, 3).flat()
  assert.ok(days.includes('2026-03-29'))
  assert.ok(days.includes('2026-03-30'))
  assert.equal(new Set(days).size, days.length, 'bez duplikatów')
})

test('arytmetyka dat', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(daysBetween('2026-10-16', '2026-11-08'), 23)
  assert.equal(daysBetween('2026-10-02T09:14', '2026-10-02T13:40'), 0, 'godzina ignorowana')
})

test('wydarzenie przez granicę tygodnia dzieli się na dwa odcinki z flagami', () => {
  const [w1, w2] = monthGrid(2026, 10).slice(2, 4) // 12–18, 19–25
  const post = { id: 'post', start: '2026-10-15', end: '2026-10-23' }
  const [a] = layoutWeek([post], w1)
  const [b] = layoutWeek([post], w2)
  assert.deepEqual([a.startCol, a.span, a.continuesBefore, a.continuesAfter], [3, 4, false, true])
  assert.deepEqual([b.startCol, b.span, b.continuesBefore, b.continuesAfter], [0, 5, true, false])
})

test('tory: nakładające się dostają różne tory, rozłączne dzielą tor', () => {
  const week = monthGrid(2026, 10)[2]
  const segments = layoutWeek(
    [
      { id: 'a', start: '2026-10-12', end: '2026-10-14' },
      { id: 'b', start: '2026-10-13' },
      { id: 'c', start: '2026-10-15' },
    ],
    week
  )
  const lane = (id: string) => segments.find((s) => s.item.id === id)!.lane
  assert.equal(lane('a'), 0)
  assert.equal(lane('b'), 1)
  assert.equal(lane('c'), 0, 'c zaczyna się po końcu a')
})

test('koniec przed początkiem traktujemy jak wydarzenie jednodniowe', () => {
  const week = monthGrid(2026, 10)[2]
  const [s] = layoutWeek([{ id: 'x', start: '2026-10-14', end: '2026-10-12' }], week)
  assert.equal(s.span, 1)
})

test('licznik „+N więcej" liczy ukryte odcinki per dzień', () => {
  const week = monthGrid(2026, 10)[2]
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id, start: '2026-10-14' }))
  const hidden = hiddenPerDay(layoutWeek(items, week), 3)
  assert.deepEqual(hidden, [0, 0, 1, 0, 0, 0, 0])
})

test('kolory projektów: kolejność przydziału używa każdego slotu raz', () => {
  assert.equal(new Set(PROJECT_COLOR_ORDER).size, PROJECT_COLOR_KEYS.length)
  assert.equal(nextProjectColor([]), PROJECT_COLOR_ORDER[0])
  assert.equal(nextProjectColor([PROJECT_COLOR_ORDER[0]]), PROJECT_COLOR_ORDER[1])
})

test('nieznane klucze nie wywracają aplikacji', () => {
  assert.deepEqual(projectTile('ultraviolet'), NEUTRAL_TILE)
  assert.equal(eventKind('ksef_import').group, 'inne')
})

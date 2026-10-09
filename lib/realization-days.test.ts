import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  eventSpanDays,
  gearDaysForSave,
  gearDaysWithCalendarDates,
  linkDayToEvent,
  realizationDayLabel,
  resolveRealizationDays,
  restoreDays,
  softDeleteDay,
} from './realization-days'
import { duplicateGearDay, projectGearDays } from './gear-usage'
import { projectSchema, type GearDay, type Project } from './project-types'
import type { TimelineEvent } from './event-types'

function project(options: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'p1',
    client: '',
    status: 'won',
    date: '2026-03-15',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    ...options,
  }
}

function event(id: string, start: string, extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id,
    kind: 'shoot_day',
    projectId: 'p1',
    start,
    title: '',
    notes: '',
    data: {},
    source: { type: 'manual' },
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}

function day(id: string, extra: Partial<GearDay> = {}): GearDay {
  return { id, label: '', date: '', lines: [], ...extra }
}

test('wydarzenie wielodniowe to osobny dzień na każdą datę, z datą z kalendarza', () => {
  const ev = event('ev1', '2026-10-28', { end: '2026-10-30' })
  const { days, info, suggestion } = resolveRealizationDays(project({ gearDays: [] }), [ev])

  assert.equal(eventSpanDays(ev), 3)
  assert.deepEqual(
    days.map((d) => [d.date, d.eventId, d.eventDay]),
    [
      ['2026-10-28', 'ev1', 0],
      ['2026-10-29', 'ev1', 1],
      ['2026-10-30', 'ev1', 2],
    ]
  )
  assert.equal(suggestion, null, 'gearDays zapisane (puste) = nic nie podpowiadamy')
  days.forEach((d) => {
    const i = info.get(d.id)!
    assert.equal(i.link, 'calendar')
    assert.equal(i.saved, false, 'dzień z kalendarza zapisze się dopiero przy pierwszej zmianie')
    assert.equal(i.pendingLink, true)
    assert.equal(i.eventSpan, 3)
  })
})

test('zapisany dzień idzie za przesuniętym wydarzeniem razem ze sprzętem', () => {
  const stored = day('gd1', { date: '2026-10-28', eventId: 'ev1', eventDay: 1, lines: [{ itemId: 'fx3', qty: 1 }] })
  const moved = event('ev1', '2026-11-03', { end: '2026-11-05' })
  const { days, info } = resolveRealizationDays(project({ gearDays: [stored] }), [moved])

  const second = days.find((d) => d.id === 'gd1')!
  assert.equal(second.date, '2026-11-04', 'drugi dzień wydarzenia po przesunięciu')
  assert.deepEqual(second.lines, [{ itemId: 'fx3', qty: 1 }])
  assert.equal(info.get('gd1')!.saved, true)
  assert.equal(info.get('gd1')!.pendingLink, false)
  assert.equal(days.length, 3, 'pozostałe dni wydarzenia dochodzą z kalendarza')
})

test('stary dzień z datą dopasowuje się do wolnego wydarzenia tego dnia, ten sam typ ma pierwszeństwo', () => {
  const stored = [day('gd1', { date: '2026-10-28' }), day('gd2', { date: '2026-10-28', kind: 'prep_day' })]
  const events = [event('shoot', '2026-10-28'), event('prep', '2026-10-28', { kind: 'prep_day' })]
  const { days, info } = resolveRealizationDays(project({ gearDays: stored }), events)

  assert.equal(days.length, 2, 'nic się nie dubluje')
  assert.equal(days.find((d) => d.id === 'gd1')!.eventId, 'shoot')
  assert.equal(days.find((d) => d.id === 'gd2')!.eventId, 'prep')
  assert.equal(info.get('gd2')!.kind, 'prep_day')
  assert.equal(info.get('gd1')!.pendingLink, true, 'dopasowanie po dacie zapisze się przy pierwszej zmianie')
})

test('dzień z datą bez wydarzenia i dzień bez daty zostają, chronologicznie i bez daty na końcu', () => {
  const stored = [day('undated'), day('later', { date: '2026-11-02' }), day('early', { date: '2026-10-01' })]
  const { days, info } = resolveRealizationDays(project({ gearDays: stored }), [event('ev1', '2026-10-15')])

  assert.deepEqual(
    days.map((d) => d.id),
    ['early', 'gd-ev1-0', 'later', 'undated']
  )
  assert.equal(info.get('early')!.link, 'not-in-calendar')
  assert.equal(info.get('undated')!.link, 'undated')
})

test('usunięte wydarzenie nie kasuje dnia: zostaje z ostatnią datą i znacznikiem', () => {
  const stored = day('gd1', { date: '2026-10-28', eventId: 'ev1', eventDay: 0, lines: [{ itemId: 'fx3', qty: 1 }] })
  const deleted = event('ev1', '2026-10-28', { deletedAt: '2026-10-09T10:00:00Z' })
  const { days, info } = resolveRealizationDays(project({ gearDays: [stored] }), [deleted])

  assert.equal(days.length, 1)
  assert.equal(days[0].date, '2026-10-28')
  assert.equal(days[0].eventId, 'ev1', 'powiązanie zostaje — przywrócenie wydarzenia je odnowi')
  assert.equal(info.get('gd1')!.link, 'event-gone')
  assert.equal(info.get('gd1')!.event?.id, 'ev1')

  const restored = resolveRealizationDays(project({ gearDays: [stored] }), [{ ...deleted, deletedAt: undefined }])
  assert.equal(restored.info.get('gd1')!.link, 'calendar')
})

test('brak wydarzeń w pamięci (np. jeszcze się wczytują) nie zrywa powiązań', () => {
  const stored = day('gd1', { date: '2026-10-28', eventId: 'ev1', eventDay: 0 })
  const { days, info } = resolveRealizationDays(project({ gearDays: [stored] }), [])
  assert.equal(days[0].eventId, 'ev1')
  assert.equal(info.get('gd1')!.link, 'event-gone')
})

test('skrócone wydarzenie, zmieniony typ albo projekt: dzień zostaje jako „zmienione"', () => {
  const stored = [
    day('third', { date: '2026-10-30', eventId: 'ev1', eventDay: 2 }),
    day('post', { date: '2026-11-10', eventId: 'ev2', eventDay: 0 }),
    day('other', { date: '2026-11-12', eventId: 'ev3', eventDay: 0 }),
  ]
  const events = [
    event('ev1', '2026-10-28', { end: '2026-10-29' }),
    event('ev2', '2026-11-10', { kind: 'post_day' }),
    event('ev3', '2026-11-12', { projectId: 'p2' }),
  ]
  const { days, info } = resolveRealizationDays(project({ gearDays: stored }), events)

  assert.equal(info.get('third')!.link, 'event-changed')
  assert.equal(days.find((d) => d.id === 'third')!.date, '2026-10-30', 'ostatnia znana data')
  assert.equal(info.get('post')!.link, 'event-changed')
  assert.equal(info.get('other')!.link, 'event-changed')
  assert.equal(days.filter((d) => d.eventId === 'ev1').length, 3, 'dwa żywe dni ev1 + skrócony')
})

test('dwa dni wskazujące ten sam dzień wydarzenia: pierwszy wygrywa, drugi nie dubluje kalendarza', () => {
  const stored = [
    day('a', { date: '2026-10-28', eventId: 'ev1', eventDay: 0 }),
    day('b', { date: '2026-10-28', eventId: 'ev1', eventDay: 0 }),
  ]
  const { info } = resolveRealizationDays(project({ gearDays: stored }), [event('ev1', '2026-10-28')])
  assert.equal(info.get('a')!.link, 'calendar')
  assert.equal(info.get('b')!.link, 'not-in-calendar')
})

test('bez zapisanych dni: stary kształt siada po kolei na dni z kalendarza', () => {
  const p = project({ equipment: [{ itemId: 'fx3', days: 2 }] })
  const { days, suggestion } = resolveRealizationDays(p, [event('ev1', '2026-10-28', { end: '2026-10-30' })])

  assert.equal(suggestion, 'legacy')
  assert.deepEqual(
    days.map((d) => [d.date, d.lines.length]),
    [
      ['2026-10-28', 1],
      ['2026-10-29', 1],
      ['2026-10-30', 0],
    ]
  )
})

test('bez zapisanych dni i bez kalendarza: liczba dni z wyceny, a bez niej jeden dzień', () => {
  const quick = { data: { dniZdjeciowe: 2 } } as unknown as Project['quote']
  const fromQuote = resolveRealizationDays(project({ quote: quick }), [])
  assert.equal(fromQuote.suggestion, 'quote')
  assert.equal(fromQuote.days.length, 2)

  const single = resolveRealizationDays(project(), [])
  assert.equal(single.suggestion, 'single')
  assert.equal(single.days.length, 1)

  const calendar = resolveRealizationDays(project({ quote: quick }), [event('ev1', '2026-10-28')])
  assert.equal(calendar.suggestion, 'calendar', 'kalendarz wygrywa z liczbą dni w wycenie')
  assert.equal(calendar.days.length, 1)
})

test('cudze, usunięte i nie-produkcyjne wydarzenia nie tworzą dni', () => {
  const events = [
    event('other', '2026-10-28', { projectId: 'p2' }),
    event('gone', '2026-10-29', { deletedAt: 'x' }),
    event('post', '2026-10-30', { kind: 'post_day' }),
    event('bad', '', {}),
  ]
  assert.equal(resolveRealizationDays(project({ gearDays: [] }), events).days.length, 0)
})

test('usunięty dzień znika z widoku i statystyk, ale zostaje w zapisie i da się go przywrócić', () => {
  const live = day('a', { date: '2026-10-28', lines: [{ itemId: 'fx3', qty: 1 }] })
  const deleted = softDeleteDay([live, day('b')], 'a', 'T1')
  const p = project({ gearDays: deleted })

  assert.deepEqual(
    resolveRealizationDays(p, []).days.map((d) => d.id),
    ['b']
  )
  assert.deepEqual(projectGearDays(p).map((d) => d.id), ['b'], 'statystyki i pakowanie bez usuniętego dnia')

  const visible = resolveRealizationDays(p, []).days
  const saved = gearDaysForSave(visible, p.gearDays)
  assert.deepEqual(saved.map((d) => d.id), ['b', 'a'], 'zapis widocznych dni nie gubi usuniętego')

  const back = restoreDays(saved, 'T1')
  assert.equal(back.find((d) => d.id === 'a')!.deletedAt, undefined)
  assert.equal('deletedAt' in back.find((d) => d.id === 'a')!, false)
})

test('dzień z kalendarza nie zajmuje id usuniętego rekordu', () => {
  const p = project({ gearDays: [day('gd-ev1-0', { eventId: 'ev1', eventDay: 0, deletedAt: 'T1' })] })
  const { days } = resolveRealizationDays(p, [event('ev1', '2026-10-28')])
  assert.equal(days.length, 1)
  assert.notEqual(days[0].id, 'gd-ev1-0')
})

test('kopia dnia nie przejmuje powiązania z kalendarzem ani usunięcia', () => {
  const days = duplicateGearDay([day('a', { date: '2026-10-28', eventId: 'ev1', eventDay: 0, kind: 'prep_day' })], 'a')
  assert.equal(days[1].eventId, undefined)
  assert.equal(days[1].eventDay, undefined)
  assert.equal(days[1].date, '')
  assert.equal(days[1].kind, 'prep_day')
})

test('linkDayToEvent wiąże dzień z nowym wydarzeniem', () => {
  const [linked] = linkDayToEvent([day('a')], 'a', { id: 'ev9', start: '2026-12-01' })
  assert.deepEqual([linked.eventId, linked.eventDay, linked.date], ['ev9', 0, '2026-12-01'])
})

test('statystyki biorą datę z kalendarza, a bez wydarzenia — ostatnią znaną', () => {
  const p = project({
    gearDays: [
      day('a', { date: '2026-10-28', eventId: 'ev1', eventDay: 0, lines: [{ itemId: 'fx3', qty: 1 }] }),
      day('b', { date: '2026-09-01', lines: [{ itemId: 'fx3', qty: 1 }] }),
    ],
  })
  const dated = gearDaysWithCalendarDates(p, [event('ev1', '2026-11-20')])
  assert.deepEqual(dated.map((d) => d.date), ['2026-11-20', '2026-09-01'])
})

test('nazwa dnia: własna, tytuł wydarzenia, „Dzień N"', () => {
  assert.equal(realizationDayLabel({ label: 'Wywiady' }, { event: event('e', '2026-01-01', { title: 'X' }) }, 0), 'Wywiady')
  assert.equal(realizationDayLabel({ label: '' }, { event: event('e', '2026-01-01', { title: 'Hala' }) }, 0), 'Hala')
  assert.equal(realizationDayLabel({ label: ' ' }, undefined, 2), 'Dzień 3')
})

test('starsza wersja: pola powiązania i usunięcia przechodzą przez schemat nietknięte', () => {
  const raw = {
    id: 'p1',
    name: 'p',
    date: '2026-10-01',
    gearDays: [
      { id: 'a', label: '', date: '2026-10-28', lines: [], eventId: 'ev1', eventDay: 2, kind: 'prep_day', future: 1 },
      { id: 'b', label: '', date: '', lines: [], eventDay: -1, deletedAt: 'T1' },
    ],
  }
  const parsed = projectSchema.parse(raw)
  assert.deepEqual(parsed.gearDays![0], raw.gearDays[0])
  assert.equal(parsed.gearDays![1].eventDay, undefined, 'zły indeks dnia → brak, nie odrzucony dzień')
  assert.equal(parsed.gearDays![1].deletedAt, 'T1')
})

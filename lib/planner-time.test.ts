/**
 * Czas i edycja wpisów planera (port z CallSheetWiz) oraz geometria osi czasu.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  clampDurationToDragBounds,
  clampMinutesToDay,
  clampStartToDragBounds,
  formatDuration,
  hhmmToMinutes,
  minutesToHHMM,
  snapTo5Minutes,
} from './time'
import { followPreviousEvent, setEventDuration, setEventEnd, setEventStart, setEventStartEnd } from './editing-engine'
import {
  assignRows,
  draggedStart,
  hourMarks,
  minutesToPx,
  nowMarker,
  pxToMinutes,
  resizedEnd,
  timelineRange,
} from './planner-timeline'
import type { PlannerEvent } from './schedule-types'

const ev = (start: number, end: number, extra: Record<string, unknown> = {}): PlannerEvent & Record<string, unknown> => ({
  id: `e${start}`,
  title: '',
  startMinutes: start,
  endMinutes: end,
  categoryId: '',
  ...extra,
})

test('czas: minuty ↔ HH:MM, z przycięciem do doby i odrzuceniem śmieci', () => {
  assert.equal(minutesToHHMM(390), '06:30')
  assert.equal(minutesToHHMM(-20), '00:00')
  assert.equal(minutesToHHMM(2000), '23:59')
  assert.equal(hhmmToMinutes('6:30'), 390)
  assert.equal(hhmmToMinutes(' 23:59 '), 1439)
  assert.equal(hhmmToMinutes('24:00'), null)
  assert.equal(hhmmToMinutes('7.30'), null)
  assert.equal(clampMinutesToDay(1500), 1439)
  assert.equal(snapTo5Minutes(392), 390)
  assert.equal(snapTo5Minutes(393), 395)
})

test('czas: granice przeciągania — domyślnie 06:00–22:00, albo podane', () => {
  assert.equal(clampStartToDragBounds(300, 60), 360)
  assert.equal(clampStartToDragBounds(1300, 60), 1260)
  assert.equal(clampStartToDragBounds(300, 60, { start: 240, end: 1320 }), 300)
  assert.equal(clampDurationToDragBounds(1290, 60), 30)
  assert.equal(formatDuration(420, 510), '1 h 30 min')
  assert.equal(formatDuration(420, 540), '2 h')
  assert.equal(formatDuration(420, 465), '45 min')
})

test('edycja: początek i koniec zachowują czas trwania, pola spoza schematu zostają', () => {
  const event = ev(420, 480, { future: { keep: true } })
  assert.deepEqual([setEventStart(event, 600).startMinutes, setEventStart(event, 600).endMinutes], [600, 660])
  assert.deepEqual([setEventEnd(event, 600).startMinutes, setEventEnd(event, 600).endMinutes], [540, 600])
  assert.equal(setEventDuration(event, 90).endMinutes, 510)
  assert.equal(setEventStartEnd(event, 500, 450).endMinutes, 500, 'koniec nie może być przed początkiem')
  assert.deepEqual(setEventStart(event, 600).future, { keep: true })
  const next = followPreviousEvent(ev(900, 930), ev(420, 510))
  assert.deepEqual([next.startMinutes, next.endMinutes], [510, 540])
  assert.equal(followPreviousEvent(event, null), event)
})

test('oś: nachodzące wpisy w osobnych rzędach, styczne w jednym', () => {
  const rows = assignRows([ev(420, 480), ev(450, 500), ev(480, 540), ev(500, 560)])
  assert.deepEqual(
    rows.map((r) => r.map((e) => e.startMinutes)),
    [
      [420, 480],
      [450, 500],
    ]
  )
})

test('oś: zakres 06–22 rozszerza się do pełnych godzin, gdy dzień wystaje', () => {
  assert.deepEqual(timelineRange([]), { start: 360, end: 1320 })
  assert.deepEqual(timelineRange([ev(330, 400), ev(1300, 1350)]), { start: 300, end: 1380 })
  assert.deepEqual(timelineRange([ev(420, 480)]), { start: 360, end: 1320 })
  assert.deepEqual(hourMarks({ start: 360, end: 540 }), [360, 420, 480, 540])
  const range = { start: 360, end: 1320 }
  assert.equal(minutesToPx(840, range, 960), 480)
  assert.equal(pxToMinutes(480, range, 960), 840)
})

test('oś: przeciąganie trzyma siatkę 5 minut i granice osi', () => {
  const range = { start: 360, end: 1320 }
  const width = 960 // 1 px = 1 min
  assert.equal(draggedStart(ev(420, 480), 32, range, width), 450)
  assert.equal(draggedStart(ev(420, 480), -500, range, width), 360)
  assert.equal(draggedStart(ev(420, 480), 5000, range, width), 1260)
  assert.equal(resizedEnd(ev(420, 480), 22, range, width), 500)
  assert.equal(resizedEnd(ev(420, 480), -300, range, width), 425, 'najkrótszy wpis ma 5 minut')
  assert.equal(resizedEnd(ev(1200, 1260), 500, range, width), 1320)
})

test('oś: znacznik „teraz" tylko w dniu zdjęć i w zakresie osi', () => {
  const range = { start: 360, end: 1320 }
  const at = new Date(2026, 9, 28, 9, 15)
  assert.equal(nowMarker(at, '2026-10-28', range, '2026-10-28'), 555)
  assert.equal(nowMarker(at, '2026-10-29', range, '2026-10-28'), null)
  assert.equal(nowMarker(at, '', range, '2026-10-28'), null)
  assert.equal(nowMarker(new Date(2026, 9, 28, 5, 0), '2026-10-28', range, '2026-10-28'), null)
})

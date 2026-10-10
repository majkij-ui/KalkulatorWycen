/**
 * Oś czasu planera dnia (T5b) — geometria i przeciąganie, czyste funkcje.
 *
 * Port logiki z `visual-timeline.tsx` CallSheetWiz: rzędy dla nachodzących
 * na siebie wpisów, przeliczanie piksele ↔ minuty, siatka 5 minut przy
 * przeciąganiu i zmianie długości. Różnice: zakres osi to domyślnie
 * 06:00–22:00, ale rozszerza się do pełnych godzin, gdy dzień zaczyna się
 * wcześniej albo kończy później (CallSheetWiz ucinał), a zmiana długości też
 * trzyma się siatki 5 minut (tak mówiły zasady CallSheetWiz, kod tego nie robił).
 */

import {
  DRAG_END_MIN,
  DRAG_START_MIN,
  clampDurationToDragBounds,
  clampStartToDragBounds,
  snapTo5Minutes,
  type DragBounds,
} from './time'

type Timed = { startMinutes: number; endMinutes: number }

/** Najkrótszy wpis (jak w CallSheetWiz). */
export const MIN_DURATION_MIN = 5

/**
 * Rzędy: wpisy po godzinie, każdy w pierwszym rzędzie, w którym poprzedni
 * wpis już się skończył. Wpisy styczne (koniec = początek) dzielą rząd.
 */
export function assignRows<E extends Timed>(events: E[]): E[][] {
  const sorted = [...events].sort((a, b) => a.startMinutes - b.startMinutes)
  const rows: E[][] = []
  for (const event of sorted) {
    const row = rows.find((r) => event.startMinutes >= r[r.length - 1].endMinutes)
    if (row) row.push(event)
    else rows.push([event])
  }
  return rows
}

/** Zakres osi: 06:00–22:00, rozszerzony do pełnych godzin, żeby żaden wpis nie wystawał. */
export function timelineRange(events: Timed[]): DragBounds {
  if (events.length === 0) return { start: DRAG_START_MIN, end: DRAG_END_MIN }
  const earliest = Math.min(...events.map((e) => e.startMinutes))
  const latest = Math.max(...events.map((e) => e.endMinutes))
  return {
    start: Math.max(0, Math.min(DRAG_START_MIN, Math.floor(earliest / 60) * 60)),
    end: Math.min(24 * 60, Math.max(DRAG_END_MIN, Math.ceil(latest / 60) * 60)),
  }
}

/** Granice przeciągania w obrębie doby (koniec osi 24:00 → 23:59). */
export function dragBounds(range: DragBounds): DragBounds {
  return { start: range.start, end: Math.min(1439, range.end) }
}

export function rangeSpan(range: DragBounds): number {
  return Math.max(1, range.end - range.start)
}

export function minutesToPx(minutes: number, range: DragBounds, width: number): number {
  return ((minutes - range.start) / rangeSpan(range)) * width
}

export function pxToMinutes(px: number, range: DragBounds, width: number): number {
  return range.start + (px / Math.max(1, width)) * rangeSpan(range)
}

/** Pełne godziny na osi (etykiety i linie siatki). */
export function hourMarks(range: DragBounds): number[] {
  const marks: number[] = []
  for (let m = Math.ceil(range.start / 60) * 60; m <= range.end; m += 60) marks.push(m)
  return marks
}

/**
 * Przeciąganie wpisu: nowy początek po przesunięciu o `deltaPx`, na siatce
 * 5 minut, z całym wpisem w granicach osi.
 */
export function draggedStart(event: Timed, deltaPx: number, range: DragBounds, width: number): number {
  const duration = event.endMinutes - event.startMinutes
  const raw = event.startMinutes + (deltaPx / Math.max(1, width)) * rangeSpan(range)
  return clampStartToDragBounds(snapTo5Minutes(raw), duration, dragBounds(range))
}

/** Zmiana długości prawą krawędzią: nowy koniec, min. 5 minut, na siatce 5 minut, w granicach osi. */
export function resizedEnd(event: Timed, deltaPx: number, range: DragBounds, width: number): number {
  const duration = event.endMinutes - event.startMinutes
  const raw = duration + (deltaPx / Math.max(1, width)) * rangeSpan(range)
  const snapped = Math.max(MIN_DURATION_MIN, snapTo5Minutes(raw))
  return event.startMinutes + Math.max(MIN_DURATION_MIN, clampDurationToDragBounds(event.startMinutes, snapped, dragBounds(range)))
}

/**
 * Znacznik „teraz": tylko w dniu zdjęć i tylko w zakresie osi (CallSheetWiz
 * pokazywał go zawsze — w hubie call sheet ma swoją datę).
 */
export function nowMarker(now: Date, dayDate: string, range: DragBounds, todayKey: string): number | null {
  if (!dayDate || dayDate !== todayKey) return null
  const minutes = now.getHours() * 60 + now.getMinutes()
  return minutes >= range.start && minutes < range.end ? minutes : null
}

/**
 * Czas w planerze dnia (call sheet, T5b): zawsze MINUTY OD PÓŁNOCY
 * (0 = 00:00, 1439 = 23:59). W danych nigdy nie zapisujemy „06:30".
 *
 * Przeniesione z CallSheetWiz (`lib/time.ts`, repo-archiwum — kopiujemy, nie
 * edytujemy tamtego). Zachowanie bez zmian; dwie zmiany na potrzeby huba:
 * daty po polsku (`formatLongDate`) i granice przeciągania jako parametr z
 * domyślnym 06:00–22:00 (oś czasu rozszerza się, gdy dzień zaczyna się
 * wcześniej). Moduł czysty.
 */

/** Lokalna data `YYYY-MM-DD` (nie UTC — w PL `toISOString` potrafi przesunąć dobę). */
export function formatLocalYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** „sobota, 19 lipca 2026" — tylko po stronie klienta (zależy od strefy). */
export function formatLongDate(date: Date): string {
  return date.toLocaleDateString('pl-PL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** Dziś w południe lokalnie — bezpieczne do zapisu, bez przeskoku doby. */
export function todayAtNoon(): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return d
}

/** Minuty od północy → „HH:MM". */
export function minutesToHHMM(minutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.floor(minutes)))
  const h = Math.floor(m / 60) % 24
  const min = m % 60
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

/** „HH:MM" albo „H:MM" → minuty od północy; `null`, gdy to nie godzina. */
export function hhmmToMinutes(hhmm: string): number | null {
  const trimmed = hhmm.trim()
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hour = parseInt(match[1], 10)
  const minute = parseInt(match[2], 10)
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

/** Czas trwania w minutach (koniec ≥ początek, inaczej 0). */
export function getDurationMinutes(startMinutes: number, endMinutes: number): number {
  return Math.max(0, Math.floor(endMinutes) - Math.floor(startMinutes))
}

/** Przycina do jednej doby (0–1439). */
export function clampMinutesToDay(minutes: number): number {
  const m = Math.floor(minutes)
  if (m < 0) return 0
  if (m > 1439) return 1439
  return m
}

/** Najbliższa pełna kwadrans (0, 15, 30, 45…). */
export function snapTo15Minutes(minutes: number): number {
  const m = Math.floor(minutes)
  return Math.round(m / 15) * 15
}

/** Najbliższe 5 minut (0, 5, 10…) — siatka przeciągania na osi czasu. */
export function snapTo5Minutes(minutes: number): number {
  const m = Math.floor(minutes)
  return Math.round(m / 5) * 5
}

/** Domyślne granice przeciągania: 06:00 = 360, 22:00 = 1320. */
export const DRAG_START_MIN = 6 * 60
export const DRAG_END_MIN = 22 * 60

export interface DragBounds {
  start: number
  end: number
}

const DEFAULT_BOUNDS: DragBounds = { start: DRAG_START_MIN, end: DRAG_END_MIN }

/** Początek tak, żeby całe wydarzenie (początek + czas trwania) zmieściło się w granicach. */
export function clampStartToDragBounds(
  startMinutes: number,
  durationMinutes: number,
  bounds: DragBounds = DEFAULT_BOUNDS
): number {
  const start = Math.floor(startMinutes)
  const duration = Math.max(0, Math.floor(durationMinutes))
  const minStart = bounds.start
  const maxStart = Math.max(minStart, bounds.end - duration)
  if (start < minStart) return minStart
  if (start > maxStart) return maxStart
  return start
}

/** Czas trwania tak, żeby koniec nie wyszedł za górną granicę. */
export function clampDurationToDragBounds(
  startMinutes: number,
  durationMinutes: number,
  bounds: DragBounds = DEFAULT_BOUNDS
): number {
  const start = Math.floor(startMinutes)
  const duration = Math.max(0, Math.floor(durationMinutes))
  const maxDuration = bounds.end - start
  return Math.min(duration, maxDuration)
}

/** „1 h 30 min", „45 min", „2 h" — czas trwania w harmonogramie i na wydruku. */
export function formatDuration(startMinutes: number, endMinutes: number): string {
  const duration = getDurationMinutes(startMinutes, endMinutes)
  if (duration >= 60) {
    const hours = Math.floor(duration / 60)
    const minutes = duration % 60
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  }
  return `${duration} min`
}

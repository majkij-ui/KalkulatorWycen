/**
 * Co kalendarz pamięta między wejściami na ekran (plan, follow-up po T2):
 * - widok (miesiąc i zaznaczony dzień) — w `sessionStorage`, czyli do
 *   zamknięcia aplikacji: przejście do projektu i z powrotem nie cofa do
 *   bieżącego miesiąca, a nowe uruchomienie zaczyna od dziś;
 * - ukryte warstwy — w `localStorage`, na stałe (to preferencja).
 *
 * Tylko wygoda: zły albo brakujący zapis = wartości domyślne. Moduł czysty —
 * testy w `calendar-prefs.test.ts`.
 */

import { EVENT_GROUPS, type EventGroup } from './calendar-palette'

export const CALENDAR_VIEW_KEY = 'nonoise-calendar-view-v1'
export const CALENDAR_LAYERS_KEY = 'nonoise-calendar-layers-v1'

export interface CalendarView {
  year: number
  month: number
  /** Zaznaczony dzień `YYYY-MM-DD`. */
  day: string
}

/** Zapisany widok albo `null`, gdy go nie ma lub jest uszkodzony. */
export function parseCalendarView(raw: string | null): CalendarView | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<CalendarView>
    const { year, month, day } = value
    if (!Number.isInteger(year) || !Number.isInteger(month)) return null
    if ((year as number) < 2000 || (year as number) > 2100 || (month as number) < 1 || (month as number) > 12) return null
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
    return { year: year as number, month: month as number, day }
  } catch {
    return null
  }
}

/** Ukryte warstwy; nieznane klucze (np. z nowszej wersji) są pomijane. */
export function parseHiddenGroups(raw: string | null): Set<EventGroup> {
  if (!raw) return new Set()
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return new Set()
    return new Set(value.filter((g): g is EventGroup => (EVENT_GROUPS as readonly string[]).includes(g)))
  } catch {
    return new Set()
  }
}

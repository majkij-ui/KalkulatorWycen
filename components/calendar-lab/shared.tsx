/**
 * Wspólne elementy makiety kalendarza: stałe, pomocnicze i kontrakt wariantu.
 * Każdy wariant (A–D) dostaje te same dane i stan, a różni się tylko sposobem
 * pokazania „który projekt" i „jaki typ wydarzenia".
 */

import type { CSSProperties, ReactNode } from 'react'
import { dayKey } from '@/lib/calendar-layout'
import type { EventGroup, ProjectColorKey } from '@/lib/calendar-palette'
import { DEMO_PROJECTS, type DemoEvent } from './demo-data'

export const MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

/** Dopełniacz do dat: „8 października". */
const MONTHS_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
]

export const WEEKDAYS = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd']

export const archivo: CSSProperties = { fontFamily: 'var(--font-archivo)' }
export const mono: CSSProperties = { fontFamily: 'var(--font-jetbrains-mono)', fontVariantNumeric: 'tabular-nums' }

export const projectsById = new Map(DEMO_PROJECTS.map((p) => [p.id, p]))

export function eventEnd(event: DemoEvent): string {
  return event.end ? dayKey(event.end) : dayKey(event.start)
}

export function coversDay(event: DemoEvent, day: string): boolean {
  return dayKey(event.start) <= day && eventEnd(event) >= day
}

export function isRange(event: DemoEvent): boolean {
  return eventEnd(event) !== dayKey(event.start)
}

export function formatDay(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${d} ${MONTHS_GENITIVE[m - 1]}`
}

export function timeOf(value: string): string | null {
  return value.length > 10 ? value.slice(11, 16) : null
}

/** Klasa przygaszenia przy fokusie wątku (tę samą przejściówkę mają wszystkie warianty). */
export function dimClass(focusId: string | null, projectId: string | null): string {
  return `transition-opacity duration-200 ${focusId && projectId !== focusId ? 'opacity-[0.18]' : 'opacity-100'}`
}

export interface MonthGridProps {
  weeks: string[][]
  /** Wydarzenia po filtrze warstw. */
  events: DemoEvent[]
  monthPrefix: string
  today: string
  selectedDay: string
  focusId: string | null
  onSelectDay: (day: string) => void
  onFocusEvent: (event: DemoEvent) => void
}

export interface CalendarVariant {
  id: 'a' | 'b' | 'c' | 'd'
  name: string
  summary: string
  /** Kanciaste kontrolki dookoła siatki (wariant bez zaokrągleń). */
  square: boolean
  MonthGrid: (props: MonthGridProps) => ReactNode
  /** Znacznik grupy w legendzie/warstwach i w wyborze typu. */
  GroupSwatch: (props: { group: EventGroup; on?: boolean }) => ReactNode
  /** Znacznik typu w listach (panel dnia, wątek). */
  KindMark: (props: { kind: string }) => ReactNode
  /** Próbka pary projekt × grupa do tabeli wszystkich par. */
  PairSample: (props: { color: ProjectColorKey | null; group: EventGroup; label: string }) => ReactNode
}

/**
 * Edycja wpisu harmonogramu: czas trwania vs początek/koniec i „zaraz po
 * poprzednim". Minuty od północy.
 *
 * Przeniesione z CallSheetWiz (`lib/editing-engine.ts`) bez zmian w działaniu.
 * Funkcje rozkładają wpis (`...event`), więc nieznane pola przeżywają edycję.
 */

import type { PlannerEvent } from './schedule-types'
import { clampMinutesToDay, getDurationMinutes } from './time'

type Timed = Pick<PlannerEvent, 'startMinutes' | 'endMinutes'>

/** Ustawia początek i koniec; czas trwania wynika z nich. */
export function setEventStartEnd<E extends Timed>(event: E, startMinutes: number, endMinutes: number): E {
  const start = clampMinutesToDay(startMinutes)
  const end = Math.max(start, clampMinutesToDay(endMinutes))
  return { ...event, startMinutes: start, endMinutes: end }
}

/** Ustawia czas trwania; koniec liczony od początku. */
export function setEventDuration<E extends Timed>(event: E, durationMinutes: number): E {
  const duration = Math.max(0, Math.floor(durationMinutes))
  const end = clampMinutesToDay(event.startMinutes + duration)
  return { ...event, endMinutes: end }
}

/** Ustawia początek; koniec przesuwa się tak, żeby czas trwania został. */
export function setEventStart<E extends Timed>(event: E, startMinutes: number): E {
  const duration = getDurationMinutes(event.startMinutes, event.endMinutes)
  const start = clampMinutesToDay(startMinutes)
  const end = clampMinutesToDay(start + duration)
  return { ...event, startMinutes: start, endMinutes: end }
}

/** Ustawia koniec; początek przesuwa się tak, żeby czas trwania został. */
export function setEventEnd<E extends Timed>(event: E, endMinutes: number): E {
  const duration = getDurationMinutes(event.startMinutes, event.endMinutes)
  const end = clampMinutesToDay(endMinutes)
  const start = clampMinutesToDay(end - duration)
  return { ...event, startMinutes: start, endMinutes: end }
}

/**
 * „Zaraz po poprzednim": początek = koniec poprzedniego wpisu, czas trwania
 * bez zmian. Bez poprzedniego wpis zostaje, jak był.
 */
export function followPreviousEvent<E extends Timed>(event: E, previousEvent: Timed | null): E {
  if (!previousEvent) return event
  const duration = getDurationMinutes(event.startMinutes, event.endMinutes)
  const start = previousEvent.endMinutes
  const end = clampMinutesToDay(start + duration)
  return { ...event, startMinutes: start, endMinutes: end }
}

/** Nowy wpis z początku i końca. */
export function createEventFromStartEnd<P extends object>(
  partial: P,
  startMinutes: number,
  endMinutes: number
): P & Timed {
  const start = clampMinutesToDay(startMinutes)
  const end = Math.max(start, clampMinutesToDay(endMinutes))
  return { ...partial, startMinutes: start, endMinutes: end }
}

/** Nowy wpis z początku i czasu trwania. */
export function createEventFromStartDuration<P extends object>(
  partial: P,
  startMinutes: number,
  durationMinutes: number
): P & Timed {
  const start = clampMinutesToDay(startMinutes)
  const duration = Math.max(0, Math.floor(durationMinutes))
  const end = clampMinutesToDay(start + duration)
  return { ...partial, startMinutes: start, endMinutes: end }
}

/**
 * Dni realizacji projektu: zdjęciowe i przygotowań. Czyste funkcje.
 *
 * Datę dnia trzyma KALENDARZ (decyzja M.J. 2026-10-09, wariant A). Dzień
 * zapisany w projekcie (`Project.gearDays`) wskazuje swoje wydarzenie
 * (`eventId` + `eventDay` — który dzień wydarzenia wielodniowego), a sprzęt,
 * ekipa i koszty wiszą na dniu. Przesunięcie wydarzenia w kalendarzu przenosi
 * więc dzień razem ze wszystkim, co na nim jest.
 *
 * `resolveRealizationDays` składa to, co pokazuje zakładka Realizacja:
 *
 *   wydarzenie w kalendarzu bez zapisanego dnia → dzień „z kalendarza"
 *                                                 (zapisze się przy pierwszej zmianie)
 *   zapisany dzień z powiązaniem                → data z wydarzenia
 *   zapisany dzień bez powiązania, z datą       → dopasowany po dacie, jeśli
 *                                                 wydarzenie tego dnia jest wolne
 *   wydarzenie usunięte / skrócone / zmienione  → dzień zostaje z ostatnią
 *                                                 znaną datą, nic nie przepada
 *
 * Odczyt niczego nie zapisuje: powiązania i dni z kalendarza trafiają do pliku
 * dopiero z pierwszą zmianą w zakładce (tak jak podpowiedzi w siatce G3).
 * Pole `date` dnia to ostatnia znana data — zapas dla dnia bez wydarzenia i
 * dla starszej wersji aplikacji, która powiązań nie zna.
 */

import { addDays, daysBetween } from './calendar-layout'
import { isEventDate, type TimelineEvent } from './event-types'
import { legacyToGearDays, projectGearDays, quoteShootDayCount } from './gear-usage'
import type { GearDay, Project } from './project-types'

export const REALIZATION_KINDS = ['shoot_day', 'prep_day'] as const
export type RealizationKind = (typeof REALIZATION_KINDS)[number]

export const REALIZATION_KIND_LABELS: Record<RealizationKind, string> = {
  shoot_day: 'Zdjęciowy',
  prep_day: 'Przygotowań',
}

export function isRealizationKind(kind: string): kind is RealizationKind {
  return (REALIZATION_KINDS as readonly string[]).includes(kind)
}

/** Typ dnia zapisany w rekordzie; brak albo nieznany = zdjęciowy. */
function recordKind(day: Pick<GearDay, 'kind'>): RealizationKind {
  return day.kind === 'prep_day' ? 'prep_day' : 'shoot_day'
}

/**
 * `calendar`        — dzień jest wydarzeniem w kalendarzu (data stamtąd),
 * `undated`         — bez daty, więc nie ma go w kalendarzu,
 * `not-in-calendar` — ma datę, ale żadne wydarzenie go nie wskazuje,
 * `event-gone`      — jego wydarzenie usunięto (albo nie ma go w pliku),
 * `event-changed`   — wydarzenie skrócono, zmieniono mu typ albo projekt.
 */
export type DayLink = 'calendar' | 'undated' | 'not-in-calendar' | 'event-gone' | 'event-changed'

export interface DayInfo {
  link: DayLink
  kind: RealizationKind
  /** Żywe wydarzenie przy `calendar`; usunięte albo zmienione przy `event-*`. */
  event: TimelineEvent | null
  /** Długość wydarzenia w dniach (1 = jednodniowe); 0 bez wydarzenia. */
  eventSpan: number
  /** Dzień jest w pliku projektu; `false` = z kalendarza albo podpowiedź. */
  saved: boolean
  /** Powiązanie z kalendarzem, którego jeszcze nie zapisano. */
  pendingLink: boolean
}

/** Skąd są dni projektu, który nie ma ich jeszcze zapisanych (`null` = zapisane). */
export type DaySuggestion = 'legacy' | 'calendar' | 'quote' | 'single' | null

export interface RealizationDays {
  /** Dni do pokazania i zapisu: chronologicznie, dni bez daty na końcu. */
  days: GearDay[]
  info: Map<string, DayInfo>
  suggestion: DaySuggestion
}

type DayEvent = Pick<TimelineEvent, 'id' | 'kind' | 'projectId' | 'start' | 'end' | 'deletedAt'>

/** Długość wydarzenia w dniach, zakres włącznie. */
export function eventSpanDays(event: Pick<TimelineEvent, 'start' | 'end'>): number {
  const start = event.start.slice(0, 10)
  const end = event.end && isEventDate(event.end) ? event.end.slice(0, 10) : start
  return Math.max(0, daysBetween(start, end)) + 1
}

/**
 * Data N-tego dnia wydarzenia — także usuniętego albo skróconego (rekord
 * wydarzenia zostaje w pliku). `null` = wydarzenie bez poprawnej daty.
 */
export function eventDayDate(event: Pick<TimelineEvent, 'start'>, eventDay = 0): string | null {
  return isEventDate(event.start) ? addDays(event.start.slice(0, 10), eventDay) : null
}

/** Wydarzenia dni realizacji projektu (bez usuniętych i bez poprawnej daty). */
export function projectRealizationEvents<E extends DayEvent>(projectId: string, events: E[]): E[] {
  return events.filter(
    (event) =>
      !event.deletedAt && event.projectId === projectId && isRealizationKind(event.kind) && isEventDate(event.start)
  )
}

interface Slot<E extends DayEvent> {
  event: E
  eventDay: number
  date: string
  span: number
}

const slotKey = (eventId: string, eventDay: number) => `${eventId}#${eventDay}`

/** Każdy dzień każdego wydarzenia osobno, chronologicznie. */
function slotsOf<E extends DayEvent>(events: E[]): Slot<E>[] {
  return events
    .flatMap((event) => {
      const span = eventSpanDays(event)
      const start = event.start.slice(0, 10)
      return Array.from({ length: span }, (_, i) => ({ event, eventDay: i, date: addDays(start, i), span }))
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.event.start.localeCompare(b.event.start) ||
        a.event.id.localeCompare(b.event.id) ||
        a.eventDay - b.eventDay
    )
}

/** Pierwszy wolny dzień kalendarza z tą datą; ten sam typ ma pierwszeństwo. */
function freeSlotOn<E extends DayEvent>(
  slots: Slot<E>[],
  claimed: Set<string>,
  date: string,
  kind: RealizationKind
): Slot<E> | null {
  const free = slots.filter((s) => s.date === date && !claimed.has(slotKey(s.event.id, s.eventDay)))
  return free.find((s) => s.event.kind === kind) ?? free[0] ?? null
}

/**
 * Dni realizacji projektu. `events` = WSZYSTKIE wydarzenia, także usunięte —
 * dzień, którego wydarzenie usunięto, mówi wtedy „usunięte w kalendarzu"
 * zamiast udawać, że nigdy go tam nie było.
 */
export function resolveRealizationDays<E extends DayEvent>(
  project: Pick<Project, 'id' | 'gearDays' | 'equipment' | 'quote'>,
  events: E[]
): RealizationDays {
  const slots = slotsOf(projectRealizationEvents(project.id, events))
  const slotByKey = new Map(slots.map((s) => [slotKey(s.event.id, s.eventDay), s]))
  const eventById = new Map(events.map((e) => [e.id, e]))
  const claimed = new Set<string>()

  const stored = project.gearDays ? projectGearDays(project) : null
  const legacy = stored ? [] : legacyToGearDays(project.equipment ?? [])
  const records = stored ?? legacy

  type Entry = { day: GearDay; info: DayInfo; seq: number }
  const entries: Entry[] = []

  const linkTo = (record: GearDay, slot: Slot<E>, seq: number, pendingLink: boolean): Entry => {
    claimed.add(slotKey(slot.event.id, slot.eventDay))
    return {
      day: { ...record, date: slot.date, eventId: slot.event.id, eventDay: slot.eventDay },
      info: {
        link: 'calendar',
        kind: slot.event.kind as RealizationKind,
        event: slot.event as unknown as TimelineEvent,
        eventSpan: slot.span,
        saved: !!stored,
        pendingLink,
      },
      seq,
    }
  }

  const unlinked = (record: GearDay, seq: number, link: DayLink, event: E | null = null): Entry => {
    const eventKind = event && isRealizationKind(event.kind) ? event.kind : null
    return {
      day: record,
      info: {
        link,
        kind: eventKind ?? recordKind(record),
        event: event as unknown as TimelineEvent | null,
        eventSpan: event && isEventDate(event.start) ? eventSpanDays(event) : 0,
        saved: !!stored,
        pendingLink: false,
      },
      seq,
    }
  }

  // 1. Zapisane powiązania. Dwa dni wskazujące ten sam dzień wydarzenia (np.
  //    kopia ze starszej wersji) — pierwszy wygrywa, drugi idzie do kroku 2.
  const rest: { record: GearDay; seq: number }[] = []
  records.forEach((record, seq) => {
    if (!record.eventId) {
      rest.push({ record, seq })
      return
    }
    const key = slotKey(record.eventId, record.eventDay ?? 0)
    const slot = slotByKey.get(key)
    if (slot && !claimed.has(key)) {
      entries.push(linkTo(record, slot, seq, false))
      return
    }
    if (slot) {
      rest.push({ record, seq })
      return
    }
    // Wydarzenie usunięte, skrócone albo zmienione: dopóki jego rekord jest w
    // pliku, data dnia liczy się z niego (zapisana data mogła się zestarzeć,
    // jeśli wydarzenie przesunięto, a zakładki potem nie otwierano).
    const event = eventById.get(record.eventId) ?? null
    const gone = !event || !!event.deletedAt
    const date = event ? eventDayDate(event, record.eventDay ?? 0) : null
    entries.push(unlinked(date ? { ...record, date } : record, seq, gone ? 'event-gone' : 'event-changed', event))
  })

  // 2. Dni z datą, ale bez (ważnego) powiązania: wolne wydarzenie tego dnia.
  const undated: { record: GearDay; seq: number }[] = []
  rest.forEach(({ record, seq }) => {
    if (!record.date) {
      undated.push({ record, seq })
      return
    }
    const slot = freeSlotOn(slots, claimed, record.date, recordKind(record))
    entries.push(slot ? linkTo(record, slot, seq, true) : unlinked(record, seq, 'not-in-calendar'))
  })

  // 3. Dni bez daty. Podpowiedź ze starego kształtu (nic nie zapisano) siada
  //    po kolei na dni z kalendarza; zapisany dzień bez daty zostaje bez daty.
  undated.forEach(({ record, seq }) => {
    const slot = stored ? null : slots.find((s) => !claimed.has(slotKey(s.event.id, s.eventDay)))
    entries.push(slot ? linkTo(record, slot, seq, true) : unlinked(record, seq, 'undated'))
  })

  // 4. Dni z kalendarza, których żaden zapisany dzień nie wskazuje. Id stałe
  //    (z wydarzenia), żeby siatka nie migała; nie może zająć id innego rekordu.
  const takenIds = new Set((project.gearDays ?? records).map((d) => d.id))
  slots.forEach((slot, i) => {
    if (claimed.has(slotKey(slot.event.id, slot.eventDay))) return
    let id = `gd-${slot.event.id}-${slot.eventDay}`
    while (takenIds.has(id)) id = `${id}-n`
    takenIds.add(id)
    const record: GearDay = { id, label: '', date: '', lines: [] }
    const entry = linkTo(record, slot, records.length + i, true)
    entry.info.saved = false
    entries.push(entry)
  })

  let suggestion: DaySuggestion = null
  if (!stored) {
    if (legacy.length > 0) suggestion = 'legacy'
    else if (slots.length > 0) suggestion = 'calendar'
    else {
      const count = quoteShootDayCount(project.quote)
      suggestion = count > 0 ? 'quote' : 'single'
      for (let i = 0; i < Math.max(1, count); i += 1) {
        entries.push(unlinked({ id: `gd-plan-${i + 1}`, label: '', date: '', lines: [] }, i, 'undated'))
      }
    }
  }

  entries.sort(
    (a, b) =>
      Number(!a.day.date) - Number(!b.day.date) || a.day.date.localeCompare(b.day.date) || a.seq - b.seq
  )
  return {
    days: entries.map((e) => e.day),
    info: new Map(entries.map((e) => [e.day.id, e.info])),
    suggestion,
  }
}

// ── Zapis ────────────────────────────────────────────────────────────────────

/**
 * Lista do zapisu w `Project.gearDays`: dni z zakładki (także oznaczone
 * `deletedAt`) plus wcześniej usunięte rekordy — miękko usunięty dzień
 * zostaje w pliku, żeby dało się go przywrócić.
 */
export function gearDaysForSave(visible: GearDay[], stored: GearDay[] | null | undefined): GearDay[] {
  const ids = new Set(visible.map((d) => d.id))
  return [...visible, ...(stored ?? []).filter((d) => d.deletedAt && !ids.has(d.id))]
}

/** Miękkie usunięcie dnia (koszty dnia: `softDeleteDayCosts` z tym samym znacznikiem). */
export function softDeleteDay(days: GearDay[], dayId: string, deletedAt: string): GearDay[] {
  return days.map((day) => (day.id === dayId ? { ...day, deletedAt } : day))
}

/** Przywraca dni usunięte z tym znacznikiem. */
export function restoreDays(days: GearDay[], deletedAt: string): GearDay[] {
  return days.map((day) => {
    if (day.deletedAt !== deletedAt) return day
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deletedAt: _removed, ...rest } = day
    return rest
  })
}

/** Wiąże dzień z wydarzeniem (np. po „Dodaj do kalendarza"). */
export function linkDayToEvent(days: GearDay[], dayId: string, event: Pick<TimelineEvent, 'id' | 'start'>): GearDay[] {
  return days.map((day) =>
    day.id === dayId ? { ...day, eventId: event.id, eventDay: 0, date: event.start.slice(0, 10) } : day
  )
}

// ── Statystyki ───────────────────────────────────────────────────────────────

/**
 * Dni sprzętu projektu z datami z kalendarza — dla statystyk (pierwsze i
 * ostatnie użycie, tempo). `events` = wszystkie wydarzenia, także usunięte:
 * data idzie za rekordem wydarzenia tak samo jak w zakładce. Dzień bez
 * wydarzenia ma swoją ostatnią znaną datę, tak jak dotąd.
 */
export function gearDaysWithCalendarDates<E extends DayEvent>(
  project: Pick<Project, 'id' | 'gearDays' | 'equipment'>,
  events: E[]
): GearDay[] {
  const byId = new Map(events.map((e) => [e.id, e]))
  return projectGearDays(project).map((day) => {
    const event = day.eventId ? byId.get(day.eventId) : undefined
    const date = event ? eventDayDate(event, day.eventDay ?? 0) : null
    return date ? { ...day, date } : day
  })
}

// ── Etykiety ─────────────────────────────────────────────────────────────────

/** Nazwa dnia: własna, potem tytuł wydarzenia, na końcu „Dzień N". */
export function realizationDayLabel(
  day: Pick<GearDay, 'label'>,
  info: Pick<DayInfo, 'event'> | undefined,
  index: number
): string {
  return day.label.trim() || info?.event?.title?.trim() || `Dzień ${index + 1}`
}

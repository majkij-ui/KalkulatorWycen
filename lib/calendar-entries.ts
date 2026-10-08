/**
 * Wpisy kalendarza = wydarzenia + rzutowane zakupy sprzętu.
 *
 * Zakup sprzętu ma JEDNO miejsce: datę zakupu w katalogu (`purchaseDate`).
 * Kalendarz tylko go pokazuje — nie kopiuje do `events.json`, więc zmiana
 * daty w katalogu od razu zmienia kalendarz i nic się nie rozjeżdża.
 *
 * Moduł czysty — testy w `calendar-entries.test.ts`.
 */

import { addDays, dayKey } from './calendar-layout'
import { eventData } from './event-kinds'
import { isEventDate, isPlaceable, type TimelineEvent } from './event-types'
import type { EquipmentItem } from './project-types'

export type CalendarEntry = TimelineEvent & {
  /** `gear` = rzut pozycji katalogu; edytuje się ją w katalogu, nie w wydarzeniach. */
  origin: 'event' | 'gear'
}

const GEAR_PREFIX = 'gear:'

export function gearEntryId(itemId: string): string {
  return `${GEAR_PREFIX}${itemId}`
}

/** Id pozycji katalogu dla wpisu rzutowanego; `null` dla zwykłego wydarzenia. */
export function gearItemIdOf(entry: Pick<CalendarEntry, 'id' | 'origin'>): string | null {
  return entry.origin === 'gear' ? entry.id.slice(GEAR_PREFIX.length) : null
}

export function gearPurchaseEntries(items: EquipmentItem[]): CalendarEntry[] {
  return items
    .filter((item) => isEventDate(item.purchaseDate) && item.purchaseDate.length === 10)
    .map((item) => ({
      id: gearEntryId(item.id),
      kind: 'gear_purchase',
      projectId: null,
      start: item.purchaseDate,
      title: item.name,
      notes: item.notes,
      data: { itemId: item.id, amount: item.purchasePrice },
      source: { type: 'catalogue' },
      createdAt: '',
      updatedAt: '',
      origin: 'gear' as const,
    }))
}

/**
 * Wszystko, co kalendarz pokazuje: wydarzenia z poprawną datą (bez usuniętych)
 * i zakupy z katalogu. Jeśli import kiedyś zapisze zakup jako wydarzenie
 * wskazujące pozycję katalogu, wygrywa katalog — bez podwójnego wpisu.
 */
export function buildCalendarEntries(events: TimelineEvent[], items: EquipmentItem[]): CalendarEntry[] {
  const catalogueIds = new Set(items.filter((i) => isEventDate(i.purchaseDate)).map((i) => i.id))
  const fromEvents: CalendarEntry[] = events
    .filter(isPlaceable)
    .filter((e) => !(e.kind === 'gear_purchase' && catalogueIds.has(String(eventData(e).itemId ?? ''))))
    .map((e) => ({ ...e, origin: 'event' as const }))
  return [...fromEvents, ...gearPurchaseEntries(items)].sort(
    (a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)
  )
}

// ── Podsumowanie miesiąca ────────────────────────────────────────────────────

export interface MonthSummary {
  leads: number
  /** Dni zdjęciowe w miesiącu — para (projekt, dzień) liczy się raz. */
  shootDays: number
  postDays: number
  invoicesSent: number
  invoicesPaid: number
  gearCount: number
  /** Suma cen zakupu sprzętu kupionego w miesiącu (PLN netto). */
  gearSpend: number
}

function endOf(entry: CalendarEntry): string {
  const start = dayKey(entry.start)
  const end = entry.end && isEventDate(entry.end) ? dayKey(entry.end) : start
  return end >= start ? end : start
}

/** `month` 1–12. */
export function monthSummary(entries: CalendarEntry[], year: number, month: number): MonthSummary {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  const startsIn = (kind: string) => entries.filter((e) => e.kind === kind && dayKey(e.start).startsWith(prefix))
  const daysIn = (kind: string) => {
    const days = new Set<string>()
    entries
      .filter((e) => e.kind === kind)
      .forEach((e) => {
        for (let d = dayKey(e.start); d <= endOf(e); d = addDays(d, 1)) {
          if (d.startsWith(prefix)) days.add(`${e.projectId ?? ''}|${d}`)
        }
      })
    return days.size
  }
  const gear = startsIn('gear_purchase')
  return {
    leads: startsIn('lead_in').length,
    shootDays: daysIn('shoot_day'),
    postDays: daysIn('post_day'),
    invoicesSent: startsIn('invoice_sent').length,
    invoicesPaid: startsIn('invoice_paid').length,
    gearCount: gear.length,
    gearSpend: gear.reduce((sum, e) => {
      const value = eventData(e).amount
      return sum + (typeof value === 'number' ? value : 0)
    }, 0),
  }
}

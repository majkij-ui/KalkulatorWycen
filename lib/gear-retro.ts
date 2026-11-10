/**
 * Sprzęt retro 2021–2024 (10.11.2026): uzupełnienie użycia własnego sprzętu w
 * starych projektach z wyboru zrobionego w jednorazowym narzędziu. Czyste
 * funkcje — patch dla `npm run data -- apply` składa `scripts/gear-retro-patch.mts`.
 *
 * Zasady (przypadek → zachowanie):
 *  - zestaw + N dni            → N dni sprzętu, w każdym każda pozycja zestawu
 *                                (1 szt.), `dayRate` = cena zestawu × stawka
 *                                pozycji / suma stawek z katalogu CAŁEGO zestawu,
 *  - pozycja kupiona po dacie projektu (`purchaseDate` po `equipmentDates`)
 *                              → pominięta w tym projekcie (jej udział znika,
 *                                cena zestawu spada razem z nią),
 *  - `gearEarnedOverride`      → round(procent × przychód netto projektu, 2),
 *  - postOnly                  → bez sprzętu, bez kwoty; usuwamy (miękko) tylko
 *                                importowe dni zdjęciowe „Data umowna (import)",
 *  - zestaw `null`, nie postOnly → projekt nietknięty,
 *  - projekt ma już dni sprzętu / kwotę → nietknięty,
 *  - kalendarz                 → każdy dzień sprzętu wskazuje dzień zdjęciowy
 *                                (`eventId` + `eventDay`), wg dat; brakujące dni
 *                                dokładamy: wydłużamy ostatni importowy
 *                                placeholder, a gdy ostatnim jest „prawdziwe"
 *                                wydarzenie — nowe jednodniowe wydarzenia w
 *                                kolejnych dniach; nadmiar dni zostaje bez sprzętu,
 *  - `equipmentDates`          → `purchaseDate` w katalogu.
 */

import { addDays } from './calendar-layout'
import type { TimelineEvent } from './event-types'
import { eventDayDate, eventSpanDays } from './realization-days'
import type { EquipmentItem, GearDay, Project } from './project-types'

export const IMPORT_PLACEHOLDER_NOTE = 'Data umowna (import)'

export interface RetroKit {
  name: string
  /** Cena doby całego zestawu (zł netto). */
  price: number
  items: string[]
}

export interface RetroProjectPick {
  id: string
  kit: string | null
  days: number
  percent?: number
  postOnly?: boolean
}

export interface RetroSelection {
  kits: Record<string, RetroKit>
  projects: RetroProjectPick[]
  equipmentDates?: Record<string, string>
}

export interface RetroItemTotal {
  days: number
  worked: number
  earned: number
}

export interface RetroReport {
  changed: string[]
  skipped: string[]
  /** Pozycje zestawu pominięte w projekcie (kupione po jego dacie). */
  leftOut: string[]
  warnings: string[]
  perItem: Map<string, RetroItemTotal>
}

export interface RetroPlan {
  projects: { id: string; set: Record<string, unknown> }[]
  eventUpdates: { id: string; set: Record<string, unknown> }[]
  eventUpserts: TimelineEvent[]
  equipment: { id: string; set: Record<string, unknown> }[]
  report: RetroReport
}

export interface RetroInput {
  selection: RetroSelection
  projects: Project[]
  events: TimelineEvent[]
  equipment: EquipmentItem[]
  /** Przychód netto projektu w zł (z `moneyLedger`); brak = nieznany. */
  revenue: Map<string, number | null>
  /** ISO — znacznik zmian w kalendarzu. */
  now: string
}

const round2 = (n: number) => Math.round(n * 100) / 100
const dateOf = (value: string) => value.slice(0, 10)

export function isImportPlaceholder(event: Pick<TimelineEvent, 'kind' | 'notes'>): boolean {
  return event.kind === 'shoot_day' && (event.notes ?? '').startsWith(IMPORT_PLACEHOLDER_NOTE)
}

interface DaySlot {
  eventId: string
  eventDay: number
  date: string
}

/** Dni zdjęciowe projektu (bez usuniętych), chronologicznie. */
function shootSlots(events: TimelineEvent[]): DaySlot[] {
  return events
    .flatMap((event) =>
      Array.from({ length: eventSpanDays(event) }, (_, i) => ({
        eventId: event.id,
        eventDay: i,
        date: eventDayDate(event, i) ?? '',
      }))
    )
    .filter((slot) => slot.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId) || a.eventDay - b.eventDay)
}

export function planGearRetro(input: RetroInput): RetroPlan {
  const { selection, now } = input
  const report: RetroReport = { changed: [], skipped: [], leftOut: [], warnings: [], perItem: new Map() }
  const catalog = new Map(input.equipment.map((item) => [item.id, item]))
  const projectsById = new Map(input.projects.map((p) => [p.id, p]))
  const plan: RetroPlan = { projects: [], eventUpdates: [], eventUpserts: [], equipment: [], report }

  // Daty zakupu z wyboru obowiązują od razu (przy sprawdzaniu „kupione po projekcie").
  const purchaseDate = new Map(input.equipment.map((item) => [item.id, item.purchaseDate]))
  Object.entries(selection.equipmentDates ?? {}).forEach(([id, date]) => {
    if (!catalog.has(id)) throw new Error(`equipmentDates: nie ma pozycji ${id} w katalogu`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`equipmentDates: zła data „${date}" (${id})`)
    purchaseDate.set(id, date)
    if (catalog.get(id)!.purchaseDate !== date) plan.equipment.push({ id, set: { purchaseDate: date } })
  })

  // Stawki zestawów: cena × stawka pozycji / suma stawek CAŁEGO zestawu.
  const kitRates = new Map<string, Map<string, number>>()
  Object.entries(selection.kits).forEach(([key, kit]) => {
    const rates = kit.items.map((id) => {
      const item = catalog.get(id)
      if (!item) throw new Error(`zestaw ${key}: nie ma pozycji ${id} w katalogu`)
      return item.rentalDayRate
    })
    const total = rates.reduce((a, b) => a + b, 0)
    if (!(total > 0)) throw new Error(`zestaw ${key}: suma stawek z katalogu to 0`)
    kitRates.set(key, new Map(kit.items.map((id, i) => [id, round2((kit.price * rates[i]) / total)])))
  })

  const eventsByProject = new Map<string, TimelineEvent[]>()
  input.events.forEach((event) => {
    if (event.projectId && !event.deletedAt && event.kind === 'shoot_day') {
      eventsByProject.set(event.projectId, [...(eventsByProject.get(event.projectId) ?? []), event])
    }
  })

  selection.projects.forEach((pick) => {
    const project = projectsById.get(pick.id)
    if (!project) throw new Error(`wybór: nie ma projektu ${pick.id}`)
    const label = `${project.name} (${pick.id})`
    if (project.deletedAt) {
      report.skipped.push(`${label}: projekt usunięty`)
      return
    }
    if ((project.gearDays?.length ?? 0) > 0 || project.gearEarnedOverride !== undefined || (project.equipment?.length ?? 0) > 0) {
      report.skipped.push(`${label}: ma już sprzęt albo kwotę „zarobił" — nietknięty`)
      return
    }
    const events = eventsByProject.get(pick.id) ?? []

    if (pick.postOnly) {
      const placeholders = events.filter(isImportPlaceholder)
      placeholders.forEach((event) => plan.eventUpdates.push({ id: event.id, set: { deletedAt: now, updatedAt: now } }))
      report.changed.push(`${label}: tylko postprodukcja — usunięto ${placeholders.length} dni importowych`)
      return
    }
    if (!pick.kit) return // bez zestawu: projekt nietknięty
    const kit = selection.kits[pick.kit]
    if (!kit) throw new Error(`projekt ${pick.id}: nieznany zestaw „${pick.kit}"`)
    const days = Math.floor(pick.days)
    if (!(days >= 1)) throw new Error(`projekt ${pick.id}: liczba dni musi być ≥ 1`)

    // Kalendarz: istniejące dni zdjęciowe, a brakujące dokładamy.
    const slots = shootSlots(events)
    const missing = days - slots.length
    if (missing > 0) {
      const last = slots[slots.length - 1]
      const lastEvent = last ? events.find((e) => e.id === last.eventId)! : null
      if (lastEvent && isImportPlaceholder(lastEvent)) {
        // Wydłużamy ostatni placeholder o brakujące dni (zawsze od jego ostatniego dnia).
        const end = addDays(last.date, missing)
        plan.eventUpdates.push({ id: lastEvent.id, set: { end, updatedAt: now } })
        for (let i = 1; i <= missing; i += 1) {
          slots.push({ eventId: lastEvent.id, eventDay: last.eventDay + i, date: addDays(last.date, i) })
        }
      } else {
        const first = last ? addDays(last.date, 1) : dateOf(project.date)
        for (let i = 0; i < missing; i += 1) {
          const date = addDays(first, i)
          const id = `ev-retro-sprzet-${pick.id}-${slots.length + 1}`
          plan.eventUpserts.push({
            id,
            kind: 'shoot_day',
            projectId: pick.id,
            start: date,
            title: '',
            notes: `${IMPORT_PLACEHOLDER_NOTE}: dzień dołożony przy uzupełnieniu sprzętu.`,
            data: {},
            source: { type: 'import', ref: `gear-retro#${pick.id}` },
            createdAt: now,
            updatedAt: now,
          } as TimelineEvent)
          slots.push({ eventId: id, eventDay: 0, date })
        }
      }
    }
    const used = slots.slice(0, days)
    const projectDate = used[0]?.date ?? dateOf(project.date)

    // Pozycje zestawu kupione po dacie projektu odpadają.
    const rates = kitRates.get(pick.kit)!
    const lines = kit.items.flatMap((id) => {
      const bought = purchaseDate.get(id) ?? ''
      if (bought && bought > projectDate) {
        report.leftOut.push(`${label}: ${catalog.get(id)!.name} kupiony ${bought}, projekt ${projectDate}`)
        return []
      }
      return [{ itemId: id, qty: 1, dayRate: rates.get(id)! }]
    })
    if (lines.length === 0) {
      report.skipped.push(`${label}: żadna pozycja zestawu nie była jeszcze kupiona`)
      return
    }
    const gearDays: GearDay[] = used.map((slot, i) => ({
      id: `gd-retro-${pick.id}-${i + 1}`,
      label: '',
      date: slot.date,
      lines: lines.map((line) => ({ ...line })),
      eventId: slot.eventId,
      eventDay: slot.eventDay,
    }))
    const set: Record<string, unknown> = { gearDays }

    let earned: number | null = null
    if (pick.percent !== undefined) {
      const revenue = input.revenue.get(pick.id)
      if (revenue === null || revenue === undefined) {
        report.warnings.push(`${label}: brak przychodu — sprzęt bez kwoty „zarobił"`)
      } else {
        earned = round2((pick.percent / 100) * revenue)
        set.gearEarnedOverride = earned
      }
    }
    plan.projects.push({ id: pick.id, set })
    report.changed.push(`${label}: ${kit.name} × ${days} dni${earned === null ? '' : `, zarobił ${earned}`}`)

    const weight = lines.reduce((sum, line) => sum + line.dayRate, 0)
    lines.forEach((line) => {
      const total = report.perItem.get(line.itemId) ?? { days: 0, worked: 0, earned: 0 }
      total.days += days
      total.worked = round2(total.worked + days * line.dayRate)
      if (earned !== null) total.earned = round2(total.earned + (earned * line.dayRate) / weight)
      report.perItem.set(line.itemId, total)
    })
  })

  return plan
}

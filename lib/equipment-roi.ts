/**
 * Rentowność własnego sprzętu — czyste funkcje, bez zależności od zapisu.
 *
 * Dwie liczby na każdą pozycję (decyzja M.J. 2026-10-09: śledzimy obie):
 *
 *  - `rentValue` — ODPRACOWAŁ: ile kosztowałby mnie rental za każdy dzień, w
 *    którym sprzęt pojechał na plan (sztuki × dni × stawka rentalowa). To
 *    wartość dla MNIE, także gdy klient za ten sprzęt nie zapłacił.
 *  - `clientPaid` — ZAROBIŁ: ile realnie zapłacili za niego klienci. Kwota za
 *    sprzęt z wyceny projektu (`gear-revenue.ts`) rozłożona na użyte pozycje
 *    proporcjonalnie do `rentValue`. Do czasu wyceny pozycja po pozycji (G5)
 *    to szacunek.
 *
 * Liczymy TYLKO projekty wliczane do wyników (won/done) — wycena, która nie
 * weszła, niczego nie odpracowała. Obie liczby to nie przychód firmy: nie
 * wchodzą do wyniku w `finance-calc` (zapłata za sprzęt już tam jest w
 * przychodzie projektu).
 */

import { daysBetween } from './calendar-layout'
import { projectGearRevenue, type GearRevenue } from './gear-revenue'
import { gearDayDate, hasGearLogged, projectGearDays } from './gear-usage'
import { gearDaysWithCalendarDates } from './realization-days'
import type { TimelineEvent } from './event-types'
import {
  countsTowardRevenue,
  toDateKey,
  unitsOwned,
  type EquipmentItem,
  type Project,
} from './project-types'

// ── Jeden projekt ────────────────────────────────────────────────────────────

export interface ProjectGearItemUse {
  itemId: string
  /** `null` = pozycja usunięta z katalogu (zostaje w danych projektu). */
  item: EquipmentItem | null
  /** W ilu dniach projektu pozycja była na planie. */
  daysUsed: number
  /** Sztuko-dni: 2 lampy przez 3 dni = 6. */
  unitDays: number
  rentValue: number
  clientPaid: number
  /** Daty dni użycia (dzień bez daty → data projektu), rosnąco. */
  dates: string[]
}

export interface ProjectGearSummary {
  items: ProjectGearItemUse[]
  /** Wartość rentalowa sprzętu w kolejnych dniach (kolejność jak `projectGearDays`). */
  perDay: { dayId: string; rentValue: number }[]
  rentValue: number
  /** `null` = projekt bez wyceny — nie wiadomo, ile zapłacono za sprzęt. */
  revenue: GearRevenue | null
  /** Ile z `revenue.ownGear` przypisano pozycjom (0, gdy nie ma czego obciążyć). */
  clientPaidAssigned: number
}

function toCatalogMap(catalog: EquipmentItem[] | Map<string, EquipmentItem>): Map<string, EquipmentItem> {
  return catalog instanceof Map ? catalog : new Map(catalog.map((item) => [item.id, item]))
}

/** Opcje statystyk: `events` = wydarzenia kalendarza, z których dni biorą daty. */
export interface GearStatsOptions {
  events?: Pick<TimelineEvent, 'id' | 'kind' | 'projectId' | 'start' | 'end' | 'deletedAt'>[]
}

/**
 * Sprzęt jednego projektu: co, ile dni, ile odpracował i ile zarobił. Status
 * projektu NIE jest tu sprawdzany — zakładka projektu pokazuje to także dla
 * wyceny; raport katalogu (`computeGearReport`) bierze tylko won/done.
 *
 * Z `events` data dnia powiązanego z kalendarzem pochodzi z wydarzenia (jedno
 * źródło dat, `realization-days.ts`); bez nich — z ostatniej znanej daty dnia.
 */
export function summarizeProjectGear(
  project: Project,
  catalog: EquipmentItem[] | Map<string, EquipmentItem>,
  options: GearStatsOptions = {}
): ProjectGearSummary {
  const byId = toCatalogMap(catalog)
  const days = options.events ? gearDaysWithCalendarDates(project, options.events) : projectGearDays(project)
  const uses = new Map<string, ProjectGearItemUse>()

  const perDay = days.map((day) => {
    let dayValue = 0
    day.lines.forEach((line) => {
      if (line.qty <= 0) return
      const item = byId.get(line.itemId) ?? null
      const value = item ? line.qty * item.rentalDayRate : 0
      dayValue += value
      const use = uses.get(line.itemId) ?? {
        itemId: line.itemId,
        item,
        daysUsed: 0,
        unitDays: 0,
        rentValue: 0,
        clientPaid: 0,
        dates: [],
      }
      use.daysUsed += 1
      use.unitDays += line.qty
      use.rentValue += value
      use.dates.push(gearDayDate(day, project))
      uses.set(line.itemId, use)
    })
    return { dayId: day.id, rentValue: dayValue }
  })

  const items = [...uses.values()]
  items.forEach((use) => use.dates.sort())

  // Rozkład zapłaty klienta: wagą jest wartość rentalowa; gdy wszystkie
  // stawki są puste — sztuko-dni. Pozycje spoza katalogu nic nie dostają.
  const revenue = projectGearRevenue(project)
  const inCatalog = items.filter((use) => use.item)
  const byValue = inCatalog.reduce((sum, use) => sum + use.rentValue, 0)
  const weightOf = (use: ProjectGearItemUse) => (byValue > 0 ? use.rentValue : use.unitDays)
  const totalWeight = inCatalog.reduce((sum, use) => sum + weightOf(use), 0)
  let clientPaidAssigned = 0
  if (revenue && revenue.ownGear > 0 && totalWeight > 0) {
    inCatalog.forEach((use) => {
      use.clientPaid = (revenue.ownGear * weightOf(use)) / totalWeight
    })
    clientPaidAssigned = revenue.ownGear
  }

  return {
    items,
    perDay,
    rentValue: perDay.reduce((sum, day) => sum + day.rentValue, 0),
    revenue,
    clientPaidAssigned,
  }
}

// ── Cały katalog ─────────────────────────────────────────────────────────────

export interface EquipmentRoi {
  item: EquipmentItem
  units: number
  /** Cena zakupu × sztuki. 0 = nieznana. */
  invested: number
  /** W ilu zrealizowanych projektach był. */
  projectsUsed: number
  /** Dni na planie (niezależnie od liczby sztuk). */
  daysUsed: number
  unitDays: number
  /** Odpracował. */
  rentValue: number
  /** Zarobił (szacunek do czasu G5). */
  clientPaid: number
  /** `rentValue` / zainwestowane × 100; `null` bez ceny zakupu. */
  rentValuePct: number | null
  clientPaidPct: number | null
  paidOffByRent: boolean
  paidOffByClients: boolean
  firstUsed: string | null
  lastUsed: string | null
  /**
   * Miesiące posiadania: od daty zakupu (bez niej — od pierwszego użycia) do
   * dziś albo do wycofania. Minimum 1, żeby świeży zakup nie dawał absurdalnego
   * tempa. `null` = nie ma od czego liczyć.
   */
  monthsOwned: number | null
  /** Dni na planie na miesiąc posiadania — „jak często jeździ". */
  daysPerMonth: number | null
  /**
   * Przewidywany miesiąc spłaty (`YYYY-MM`) przy dotychczasowym tempie.
   * `null` = już spłacony, wycofany, bez ceny albo bez użycia.
   */
  rentPayoffMonth: string | null
  clientPayoffMonth: string | null
}

export interface GearReportTotals {
  invested: number
  rentValue: number
  clientPaid: number
  /**
   * Zapłata klientów za sprzęt w zrealizowanych projektach, w których nie
   * zaznaczono żadnego sprzętu z katalogu — nie ma jej komu przypisać.
   */
  unassignedClientPaid: number
  rentValuePct: number | null
  clientPaidPct: number | null
  paidOffByRentCount: number
  paidOffByClientsCount: number
  activeCount: number
  retiredCount: number
  /** Aktywne pozycje ani razu nieużyte w zrealizowanym projekcie. */
  unusedCount: number
}

export interface MissingGearProject {
  project: Project
  revenue: GearRevenue | null
}

export interface GearReport {
  /** Malejąco po „odpracował". */
  items: EquipmentRoi[]
  totals: GearReportTotals
  /** Zrealizowane projekty bez wpisanego sprzętu, od najnowszego — lista do uzupełnienia. */
  missingGear: MissingGearProject[]
}

const DAYS_PER_MONTH = 30.4375
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` + n miesięcy → `YYYY-MM`. */
function addMonthsToKey(dateKey: string, months: number): string {
  const [y, m] = dateKey.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

function projectPayoff(params: {
  value: number
  invested: number
  monthsOwned: number | null
  retired: boolean
  today: string
}): string | null {
  const { value, invested, monthsOwned, retired, today } = params
  if (retired || invested <= 0 || value >= invested || !monthsOwned) return null
  const pace = value / monthsOwned
  if (pace <= 0) return null
  return addMonthsToKey(today, Math.ceil((invested - value) / pace))
}

function pct(value: number, invested: number): number | null {
  return invested > 0 ? (value / invested) * 100 : null
}

export function computeGearReport(
  items: EquipmentItem[],
  projects: Project[],
  options: { now?: Date } & GearStatsOptions = {}
): GearReport {
  const today = toDateKey(options.now ?? new Date())
  const byId = toCatalogMap(items)
  const acc = new Map<
    string,
    { projectsUsed: number; daysUsed: number; unitDays: number; rentValue: number; clientPaid: number; dates: string[] }
  >()
  let unassignedClientPaid = 0
  const missingGear: MissingGearProject[] = []

  projects.forEach((project) => {
    if (!countsTowardRevenue(project.status)) return
    if (!hasGearLogged(project)) {
      missingGear.push({ project, revenue: projectGearRevenue(project) })
    }
    const summary = summarizeProjectGear(project, byId, { events: options.events })
    if (summary.revenue) {
      unassignedClientPaid += summary.revenue.ownGear - summary.clientPaidAssigned
    }
    summary.items.forEach((use) => {
      if (!use.item) return
      const entry = acc.get(use.itemId) ?? {
        projectsUsed: 0,
        daysUsed: 0,
        unitDays: 0,
        rentValue: 0,
        clientPaid: 0,
        dates: [],
      }
      entry.projectsUsed += 1
      entry.daysUsed += use.daysUsed
      entry.unitDays += use.unitDays
      entry.rentValue += use.rentValue
      entry.clientPaid += use.clientPaid
      entry.dates.push(...use.dates)
      acc.set(use.itemId, entry)
    })
  })

  const roi: EquipmentRoi[] = items.map((item) => {
    const used = acc.get(item.id)
    const units = unitsOwned(item)
    const invested = item.purchasePrice * units
    const dates = (used?.dates ?? []).slice().sort()
    const firstUsed = dates[0] ?? null
    const lastUsed = dates[dates.length - 1] ?? null
    const retired = !!item.retiredAt
    const since = VALID_DATE.test(item.purchaseDate) ? item.purchaseDate : firstUsed
    const until = item.retiredAt ?? today
    const monthsOwned = since ? Math.max(1, daysBetween(since, until) / DAYS_PER_MONTH) : null
    const rentValue = used?.rentValue ?? 0
    const clientPaid = used?.clientPaid ?? 0
    const daysUsed = used?.daysUsed ?? 0

    return {
      item,
      units,
      invested,
      projectsUsed: used?.projectsUsed ?? 0,
      daysUsed,
      unitDays: used?.unitDays ?? 0,
      rentValue,
      clientPaid,
      rentValuePct: pct(rentValue, invested),
      clientPaidPct: pct(clientPaid, invested),
      paidOffByRent: invested > 0 && rentValue >= invested,
      paidOffByClients: invested > 0 && clientPaid >= invested,
      firstUsed,
      lastUsed,
      monthsOwned,
      daysPerMonth: monthsOwned ? daysUsed / monthsOwned : null,
      rentPayoffMonth: projectPayoff({ value: rentValue, invested, monthsOwned, retired, today }),
      clientPayoffMonth: projectPayoff({ value: clientPaid, invested, monthsOwned, retired, today }),
    }
  })
  roi.sort((a, b) => b.rentValue - a.rentValue || a.item.name.localeCompare(b.item.name, 'pl'))

  const totals = roi.reduce<GearReportTotals>(
    (sum, r) => {
      const retired = !!r.item.retiredAt
      sum.invested += r.invested
      sum.rentValue += r.rentValue
      sum.clientPaid += r.clientPaid
      if (r.paidOffByRent) sum.paidOffByRentCount += 1
      if (r.paidOffByClients) sum.paidOffByClientsCount += 1
      if (retired) sum.retiredCount += 1
      else sum.activeCount += 1
      if (!retired && r.daysUsed === 0) sum.unusedCount += 1
      return sum
    },
    {
      invested: 0,
      rentValue: 0,
      clientPaid: 0,
      unassignedClientPaid,
      rentValuePct: null,
      clientPaidPct: null,
      paidOffByRentCount: 0,
      paidOffByClientsCount: 0,
      activeCount: 0,
      retiredCount: 0,
      unusedCount: 0,
    }
  )
  totals.rentValuePct = pct(totals.rentValue, totals.invested)
  totals.clientPaidPct = pct(totals.clientPaid, totals.invested)

  missingGear.sort((a, b) => b.project.date.localeCompare(a.project.date))
  return { items: roi, totals, missingGear }
}

function lastDate(use: ProjectGearItemUse): string {
  return use.dates[use.dates.length - 1] ?? ''
}

/** Historia jednej pozycji: zrealizowane projekty, w których była, od najnowszego. */
export function itemUsageHistory(
  itemId: string,
  projects: Project[],
  catalog: EquipmentItem[],
  options: GearStatsOptions = {}
): { project: Project; use: ProjectGearItemUse }[] {
  const byId = toCatalogMap(catalog)
  return projects
    .filter((project) => countsTowardRevenue(project.status))
    .flatMap((project) => {
      const use = summarizeProjectGear(project, byId, options).items.find((u) => u.itemId === itemId)
      return use ? [{ project, use }] : []
    })
    .sort((a, b) => lastDate(b.use).localeCompare(lastDate(a.use)))
}

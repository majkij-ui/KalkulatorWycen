/**
 * Wynajem sprzętu jako JEDNA liczba projektu (U2, plan §17.1) — czyste funkcje.
 *
 * Suma wynajmu projektu = zaznaczone, zewnętrzne wiersze kategorii `wynajem`
 * w Realizacji: „Wynajem sprzętu" na cały projekt, pozycje z wynajmu i wynajem
 * w dniach. Wszyscy czytają tę jedną liczbę: „ile zarobił sprzęt"
 * (`gear-earnings.ts`), Finanse firmy i raport okresowy. Istniejące wiersze
 * `wynajem` wchodzą do sumy takie, jakie są — żadna kwota się nie zmienia.
 *
 * Wpisana kwota i pozycje (decyzja M.J. 2026-10-24): wiersz „Wynajem sprzętu"
 * bez pozycji to kwota wpisana za projekt. Pozycje z wynajmu (ze słownika
 * `rental-items.json`) najpierw ją wypełniają — wiersz trzyma resztę „bez
 * szczegółów" — a gdy jej zabraknie, podnoszą sumę. Wpisana kwota siedzi na
 * wierszu (`rentalTotal`), więc suma kosztów to zawsze suma wierszy i pętla
 * pieniędzy liczy dokładnie to samo co dotąd.
 *
 * Projekt, w którego Realizacji nic jeszcze nie zapisano, liczy wynajem z
 * planu (szkic z wyceny) — tak jak Finanse liczą wtedy plan.
 */

import { costAmount, isOwnWork, liveCosts, makeCost } from './project-costs'
import { countsTowardRevenue, toYear, type GearDay, type Project, type ProjectCost } from './project-types'
import { draftCosts, editPatch, planKeyDay, quotePlanRows, realizationMode, type CostInit } from './realization-costs'
import type { FinancialsSource } from './quote-financials'
import { createRentalItemId, type RentalItem } from './rental-types'

export const RENTAL_CATEGORY = 'wynajem'
/** Opis stałego wiersza na górze „Kosztów projektu". */
export const RENTAL_LINE_LABEL = 'Wynajem sprzętu'

export function isRental(cost: Pick<ProjectCost, 'category'>): boolean {
  return cost.category === RENTAL_CATEGORY
}

/** Wiersz wynajmu, który się liczy: nieusunięty, zaznaczony, zewnętrzny. */
export function countsAsRental(cost: Pick<ProjectCost, 'category' | 'deletedAt' | 'skipped' | 'ownWork'>): boolean {
  return isRental(cost) && !cost.deletedAt && !cost.skipped && !isOwnWork(cost)
}

/** Suma wynajmu z wierszy Realizacji (jedna liczba projektu). */
export function rentalTotal(costs: ProjectCost[] | null | undefined): number {
  return liveCosts(costs).reduce((sum, cost) => sum + (countsAsRental(cost) ? costAmount(cost) : 0), 0)
}

/**
 * Wiersze Realizacji projektu tak, jak liczą je Finanse: zapisane, a gdy nie
 * ma jeszcze żadnego żywego — szkic z zapisanej wyceny (plan).
 */
export function realizationLines(
  project: Pick<Project, 'costs' | 'costsFromQuoteAt'> & { quote?: unknown }
): ProjectCost[] {
  if (realizationMode(project) !== 'draft') return project.costs ?? []
  return draftCosts(quotePlanRows((project.quote ?? null) as FinancialsSource | null).rows, [])
}

/** Suma wynajmu projektu z zapisanych danych (zapisane wiersze albo plan). */
export function projectRentalTotal(project: Pick<Project, 'costs' | 'costsFromQuoteAt'> & { quote?: unknown }): number {
  return rentalTotal(realizationLines(project))
}

// ── Blok „Wynajem sprzętu" w Kosztach projektu ───────────────────────────────

/** Wiersz całego projektu (nie dnia): bez żywego dnia i nie z dnia wyceny. */
function isProjectLevel(cost: ProjectCost, dayIds: ReadonlySet<string>): boolean {
  if (cost.dayId && dayIds.has(cost.dayId)) return false
  return planKeyDay(cost.planKey) === null
}

export interface RentalBlock {
  /** „Wynajem sprzętu" bez pozycji — wpisana kwota za projekt; `null` = jeszcze nie ma wiersza (pole 0 zł). */
  rest: ProjectCost | null
  /** Czy wiersz „bez szczegółów" się liczy (zaznaczony, zewnętrzny) — tylko wtedy pozycje go wypełniają. */
  restCounts: boolean
  /** Pozostałe wiersze wynajmu całego projektu (pozycje z wynajmu). */
  items: ProjectCost[]
  /** Wynajem w dniach (te same sumy, edycja w kartach dni). */
  days: ProjectCost[]
  /** Kwota w polu „Wynajem sprzętu": wpisana (`rentalTotal`), a bez niej — reszta + pozycje. */
  typed: number
  /** Liczone pozycje razem. */
  itemsTotal: number
  /** Reszta „bez szczegółów" (kwota wiersza, gdy się liczy). */
  restAmount: number
  daysTotal: number
  /** Wynajem całego projektu (reszta + pozycje). */
  projectTotal: number
  /** JEDNA liczba projektu: projekt + dni. */
  total: number
  /** O ile pozycje przekroczyły wpisaną kwotę (0 = mieszczą się). */
  overTyped: number
}

/**
 * Czy wiersz całego projektu może być „Wynajmem sprzętu" bez szczegółów: bez
 * pozycji ze słownika i z wpisaną kwotą, z planu („Rental sprzętu") albo
 * opisany „Wynajem sprzętu" / bez opisu. Wiersz z własnym opisem („Prompter")
 * to pozycja, nie reszta.
 */
function isRestLine(cost: ProjectCost): boolean {
  if (cost.rentalItemId) return false
  if (cost.rentalTotal !== undefined || cost.planKey === 'pro:rentalSprzetu') return true
  const label = rentalNameKey(cost.label)
  return label === '' || label === rentalNameKey(RENTAL_LINE_LABEL)
}

function countedAmount(cost: ProjectCost): number {
  return countsAsRental(cost) ? costAmount(cost) : 0
}

export function rentalBlock(costs: ProjectCost[], dayIds: Iterable<string>): RentalBlock {
  const days = new Set(dayIds)
  const rentals = liveCosts(costs).filter(isRental)
  const projectLevel = rentals.filter((c) => isProjectLevel(c, days))
  const dayLines = rentals.filter((c) => !isProjectLevel(c, days))
  const candidates = projectLevel.filter(isRestLine)
  const rest = candidates.find((c) => c.rentalTotal !== undefined) ?? candidates[0] ?? null
  const items = projectLevel.filter((c) => c !== rest)
  const itemsTotal = items.reduce((sum, c) => sum + countedAmount(c), 0)
  const restCounts = !!rest && countsAsRental(rest)
  const restAmount = rest && restCounts ? costAmount(rest) : 0
  const typed = rest ? (restCounts ? (rest.rentalTotal ?? restAmount + itemsTotal) : costAmount(rest)) : itemsTotal
  const daysTotal = dayLines.reduce((sum, c) => sum + countedAmount(c), 0)
  const projectTotal = restAmount + itemsTotal
  return {
    rest,
    restCounts,
    items,
    days: dayLines,
    typed,
    itemsTotal,
    restAmount,
    daysTotal,
    projectTotal,
    total: projectTotal + daysTotal,
    overTyped: restCounts ? Math.max(0, itemsTotal - typed) : 0,
  }
}

/** Zmiana wiersza „bez szczegółów" (bez kluczy `undefined`; wiersz z planu dostaje `edited`). */
function patchRest(rest: ProjectCost, patch: Partial<ProjectCost>): ProjectCost {
  const next: Record<string, unknown> = { ...rest, ...editPatch(rest, patch) }
  Object.keys(patch).forEach((key) => {
    if ((patch as Record<string, unknown>)[key] === undefined) delete next[key]
  })
  return next as ProjectCost
}

/** Reszta przy wpisanej kwocie: `rentalTotal` tylko, gdy są pozycje (bez nich wiersz = kwota). */
function restFields(typed: number, itemsTotal: number): { quantity: number; unitCost: number; rentalTotal: number | undefined } {
  return itemsTotal > 0
    ? { quantity: 1, unitCost: Math.max(0, typed - itemsTotal), rentalTotal: typed }
    : { quantity: 1, unitCost: typed, rentalTotal: undefined }
}

/**
 * Kwota wpisana w polu „Wynajem sprzętu" (za cały projekt). Bez wiersza —
 * powstaje „Wynajem sprzętu". Pozycje zostają; wiersz trzyma resztę.
 */
export function setTypedRental(
  costs: ProjectCost[],
  value: number,
  dayIds: Iterable<string>,
  now: Date = new Date()
): ProjectCost[] {
  const typed = Math.max(0, Number.isFinite(value) ? value : 0)
  const block = rentalBlock(costs, dayIds)
  const { rest } = block
  if (!rest) {
    const { rentalTotal: total, ...fields } = restFields(typed, block.itemsTotal)
    const init: CostInit = { category: RENTAL_CATEGORY, label: RENTAL_LINE_LABEL, ...fields, ...(total !== undefined ? { rentalTotal: total } : {}) }
    return [...costs, makeCost(init, now)]
  }
  const patch = block.restCounts ? restFields(typed, block.itemsTotal) : { quantity: 1, unitCost: typed }
  return costs.map((c) => (c.id === rest.id ? patchRest(c, patch) : c))
}

/**
 * Po zmianie pozycji z wynajmu (kwota, dodanie, usunięcie, zaznaczenie):
 * pozycje najpierw wypełniają wpisaną kwotę, potem ją podnoszą. Wpisana kwota
 * to ta sprzed zmiany (`before`), więc literówka w trakcie pisania nic nie
 * psuje. Bez liczonego wiersza „bez szczegółów" pozycje po prostu się sumują.
 */
export function rebalanceRental(before: ProjectCost[], after: ProjectCost[], dayIds: Iterable<string>): ProjectCost[] {
  const ids = [...dayIds]
  const was = rentalBlock(before, ids)
  if (!was.rest || !was.restCounts) return after
  const restNow = after.find((c) => c.id === was.rest!.id)
  if (!restNow || restNow.deletedAt || !countsAsRental(restNow)) return after
  const now = rentalBlock(after, ids)
  if (now.rest?.id !== restNow.id) return after
  // Opis, dni, wypożyczalnia — pozycje kosztują tyle samo, reszty nie ruszamy
  // (wiersz z planu nie dostaje znacznika „zmieniony" bez powodu).
  if (Math.abs(now.itemsTotal - was.itemsTotal) < 1e-9) return after
  const patch = restFields(was.typed, now.itemsTotal)
  return after.map((c) => (c.id === restNow.id ? patchRest(c, patch) : c))
}

// ── Słownik wynajmowanego sprzętu ────────────────────────────────────────────

/** Klucz porównania nazw: wielkość liter, spacje i polskie znaki bez znaczenia. */
export function rentalNameKey(name: string | undefined): string {
  return (name ?? '')
    .trim()
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
}

export function liveRentalItems(items: RentalItem[]): RentalItem[] {
  return items.filter((item) => !item.deletedAt)
}

export function findRentalItemByName(items: RentalItem[], name: string): RentalItem | null {
  const key = rentalNameKey(name)
  if (!key) return null
  return liveRentalItems(items).find((item) => rentalNameKey(item.name) === key) ?? null
}

/** Nowa pozycja słownika „na miejscu"; ta sama nazwa (bez wielkości liter i ogonków) = istniejąca pozycja. */
export function addRentalItem(
  items: RentalItem[],
  name: string,
  now: string
): { items: RentalItem[]; item: RentalItem | null } {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean) return { items, item: null }
  const existing = findRentalItemByName(items, clean)
  if (existing) return { items, item: existing }
  const item: RentalItem = { id: createRentalItemId(), name: clean, createdAt: now }
  return { items: [...items, item], item }
}

export function renameRentalItem(items: RentalItem[], id: string, name: string, now: string): RentalItem[] {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean) return items
  return items.map((item) => (item.id === id ? { ...item, name: clean, updatedAt: now } : item))
}

export function removeRentalItem(items: RentalItem[], id: string, at: string): RentalItem[] {
  return items.map((item) => (item.id === id && !item.deletedAt ? { ...item, deletedAt: at } : item))
}

export function restoreRentalItem(items: RentalItem[], id: string, at: string): RentalItem[] {
  return items.map((item) => {
    if (item.id !== id || item.deletedAt !== at) return item
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deletedAt: _removed, ...rest } = item
    return rest as RentalItem
  })
}

// ── „Wynajmowany sprzęt" (zakładka w sekcji Sprzęt) ─────────────────────────

export interface RentalUse {
  projectId: string
  projectName: string
  /** Data dnia (z kalendarza, gdy podano dni z datami) albo data księgowa projektu. */
  date: string
  /** Dni wynajmu: wpisane, wiersz dnia = 1, wiersz projektu bez dni = `null`. */
  days: number | null
  vendor: string
  amount: number
}

export interface RentedItemStats {
  itemId: string
  /** `null` = pozycja usunięta ze słownika (wiersze zostały). */
  item: RentalItem | null
  name: string
  times: number
  /** Suma znanych dni. */
  days: number
  /** Ile wynajmów nie ma wpisanych dni. */
  daysUnknown: number
  total: number
  last: RentalUse | null
  byYear: Map<number, number>
  uses: RentalUse[]
}

export interface RentedGearReport {
  /** Malejąco po wydatkach. */
  items: RentedItemStats[]
  /** Wynajem bez pozycji ze słownika (wpisana kwota, stare wiersze, plan) — żeby suma się zgadzała. */
  unitemized: { times: number; total: number; projects: number; byYear: Map<number, number> }
  total: number
  byYear: Map<number, number>
  /** Lata z wynajmem, rosnąco. */
  years: number[]
}

type StatsProject = Pick<Project, 'id' | 'name' | 'status' | 'date' | 'costs' | 'costsFromQuoteAt' | 'quote'> & {
  gearDays?: GearDay[]
  deletedAt?: string
}

/**
 * Wynajem z projektów w realizacji i zrealizowanych (jak inne statystyki
 * sprzętu). `dayDates` = data dnia realizacji (np. z kalendarza); bez niej
 * data zapisana w dniu, a na końcu data projektu.
 */
export function rentedGearReport(
  projects: StatsProject[],
  dictionary: RentalItem[],
  dayDates: (project: StatsProject) => Map<string, string> = (project) =>
    new Map((project.gearDays ?? []).filter((d) => d.date).map((d) => [d.id, d.date]))
): RentedGearReport {
  const byId = new Map(dictionary.map((item) => [item.id, item]))
  const stats = new Map<string, RentedItemStats>()
  const unitemized = { times: 0, total: 0, projects: 0, byYear: new Map<number, number>() }
  const byYear = new Map<number, number>()
  let total = 0
  const add = (map: Map<number, number>, date: string, amount: number) => {
    const year = toYear(date)
    if (year !== null) map.set(year, (map.get(year) ?? 0) + amount)
  }

  projects
    .filter((p) => !p.deletedAt && countsTowardRevenue(p.status))
    .forEach((project) => {
      const dates = dayDates(project)
      let unitemizedHere = false
      liveCosts(realizationLines(project))
        .filter(countsAsRental)
        .forEach((cost) => {
          const amount = costAmount(cost)
          const date = (cost.dayId && dates.get(cost.dayId)) || project.date
          total += amount
          add(byYear, date, amount)
          if (!cost.rentalItemId) {
            if (amount <= 0) return
            unitemized.times += 1
            unitemized.total += amount
            add(unitemized.byYear, date, amount)
            unitemizedHere = true
            return
          }
          const item = byId.get(cost.rentalItemId) ?? null
          const entry: RentedItemStats = stats.get(cost.rentalItemId) ?? {
            itemId: cost.rentalItemId,
            item,
            name: item?.name ?? 'pozycja usunięta',
            times: 0,
            days: 0,
            daysUnknown: 0,
            total: 0,
            last: null,
            byYear: new Map(),
            uses: [],
          }
          const days = cost.rentalDays ?? (cost.dayId ? 1 : null)
          const use: RentalUse = {
            projectId: project.id,
            projectName: project.name,
            date,
            days,
            vendor: (cost.vendor ?? '').trim(),
            amount,
          }
          entry.times += 1
          if (days === null) entry.daysUnknown += 1
          else entry.days += days
          entry.total += amount
          add(entry.byYear, date, amount)
          entry.uses.push(use)
          if (!entry.last || date > entry.last.date) entry.last = use
          stats.set(cost.rentalItemId, entry)
        })
      if (unitemizedHere) unitemized.projects += 1
    })

  const items = [...stats.values()]
  items.forEach((entry) => entry.uses.sort((a, b) => b.date.localeCompare(a.date)))
  items.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pl'))
  return { items, unitemized, total, byYear, years: [...byYear.keys()].sort((a, b) => a - b) }
}

// ── Finanse firmy i raport okresowy ──────────────────────────────────────────

/** Wiersz okresu z rejestru marży (`marginSummary().projects`) — tyle, ile tu potrzeba. */
export interface PeriodProjectRow {
  money: { id: string; counts: boolean; costsBasis: 'actual' | 'plan' | 'none' }
  /** Kotwica w okresie — tu leżą koszty projektu. */
  anchored: boolean
}

export interface PeriodRentals {
  total: number
  /** Projekty z wynajmem, malejąco. */
  projects: { id: string; name: string; amount: number }[]
  /** Najczęściej wynajmowane pozycje okresu (liczba wynajmów, kwota). */
  top: { itemId: string; name: string; times: number; amount: number }[]
}

/**
 * Wynajem sprzętu w okresie: suma wynajmu projektów zakotwiczonych w okresie,
 * na tej samej podstawie co ich koszty bezpośrednie w rejestrze — Realizacja,
 * a gdy Finanse liczą plan (brak kosztów albo częściowe w realizacji) — plan.
 * Część kosztów bezpośrednich, nie dodatkowa liczba.
 */
export function periodRentals(
  rows: PeriodProjectRow[],
  projectsById: Map<string, Pick<Project, 'id' | 'name' | 'costs' | 'costsFromQuoteAt' | 'quote'>>,
  dictionary: RentalItem[] = []
): PeriodRentals {
  const names = new Map(dictionary.map((item) => [item.id, item.name]))
  const projects: PeriodRentals['projects'] = []
  const top = new Map<string, { itemId: string; name: string; times: number; amount: number }>()
  rows.forEach((row) => {
    if (!row.anchored || !row.money.counts || row.money.costsBasis === 'none') return
    const project = projectsById.get(row.money.id)
    if (!project) return
    const lines =
      row.money.costsBasis === 'plan'
        ? draftCosts(quotePlanRows((project.quote ?? null) as FinancialsSource | null).rows, [])
        : liveCosts(project.costs)
    const counted = lines.filter(countsAsRental)
    const amount = counted.reduce((sum, cost) => sum + costAmount(cost), 0)
    if (amount === 0) return
    projects.push({ id: project.id, name: project.name, amount })
    counted.forEach((cost) => {
      if (!cost.rentalItemId) return
      const entry = top.get(cost.rentalItemId) ?? {
        itemId: cost.rentalItemId,
        name: names.get(cost.rentalItemId) ?? 'pozycja usunięta',
        times: 0,
        amount: 0,
      }
      entry.times += 1
      entry.amount += costAmount(cost)
      top.set(cost.rentalItemId, entry)
    })
  })
  projects.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pl'))
  return {
    total: projects.reduce((sum, p) => sum + p.amount, 0),
    projects,
    top: [...top.values()].sort((a, b) => b.times - a.times || b.amount - a.amount).slice(0, 5),
  }
}

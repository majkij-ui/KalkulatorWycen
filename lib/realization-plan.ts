/**
 * Plan vs rzeczywistość projektu — czyste funkcje.
 *
 * PLAN to dzisiejsza zakładka Profit: koszty wyprowadzone z wyceny (z
 * nadpisaniami), ryczałt i kwota przelewu. Dane planu zostają tam, gdzie były
 * — w migawce wyceny (decyzja 5 planu, bez migracji); Realizacja tylko je
 * pokazuje. Projekt bez wyceny (retro-import) ma za plan zaimportowany wynik.
 *
 * RZECZYWISTOŚĆ to koszty wpisane w Realizacji (`project-costs.ts`) przy TYM
 * SAMYM przychodzie i ryczałcie co plan. Przychód z faktur policzy T6.
 */

import { isRentalCostKey, resolveProfitSections, computeProfitSummary, type ProfitLine } from './profit-calc'
import { computeQuoteTotals, computeTotalCrewDays, resolveSnapshot, type FinancialsSource } from './quote-financials'
import { isBlankQuoteData } from './project-save'
import { actualCostsByCategory, compareCategories, makeCost, costsOfDay, isCrew, totalActualCosts } from './project-costs'
import type { Project, ProjectCost, ProjectFinancials } from './project-types'
import type { QuoteData } from './quote-types'
import { safeArray, safeNum } from './safe-numbers'

export type PlanSource = 'quote' | 'import' | 'none'

export interface PlanFigures {
  /** `quote` — z wyceny (Profit), `import` — wynik z importu, `none` — brak planu. */
  source: PlanSource
  /** Kwota przelewu netto (ręczna z Profitu albo suma wyceny). */
  revenue: number
  taxRatePercent: number
  tax: number
  costs: number
  profit: number
  marginPct: number
  /** Koszty planu w kategoriach kosztów rzeczywistych; `null` = nieznany podział (import). */
  byCategory: Map<string, number> | null
}

export interface ActualFigures {
  revenue: number
  tax: number
  costs: number
  profit: number
  marginPct: number
  /** Ile pozycji kosztów wpisano (0 = rzeczywistość jeszcze nieznana). */
  costCount: number
  byCategory: Map<string, number>
}

const DEFAULT_TAX_RATE = 8.5

// ── Plan ─────────────────────────────────────────────────────────────────────

/**
 * Kategoria kosztu rzeczywistego dla pozycji planu (klucze z `profit-calc.ts`).
 * Ekipa = ludzie na planie; reszta tak, jak zwykle wychodzi na fakturach.
 */
export function planLineCategory(line: Pick<ProfitLine, 'key' | 'section' | 'isCustom'>): string {
  const { key } = line
  if (line.isCustom) {
    if (line.section === 'preprodukcja') return 'preprodukcja'
    if (line.section === 'postprodukcja') return 'postprodukcja'
    return 'inne'
  }
  if (isRentalCostKey(key)) return 'wynajem'
  if (key === 'log:dojazd') return 'dojazd'
  if (key === 'log:catering') return 'catering'
  if (key === 'log:noclegi') return 'nocleg'
  if (key.startsWith('pre:')) return 'preprodukcja'
  if (key.startsWith('post:')) return 'postprodukcja'
  if (key.startsWith('pro:')) return 'ekipa'
  return 'inne'
}

function byCategory(lines: ProfitLine[]): Map<string, number> {
  const totals = new Map<string, number>()
  lines.forEach((line) => {
    if (line.total === 0) return
    const category = planLineCategory(line)
    totals.set(category, (totals.get(category) ?? 0) + line.total)
  })
  return new Map([...totals.entries()].sort(([a], [b]) => compareCategories(a, b)))
}

/** Plan z migawki wyceny — te same liczby co zakładka Profit i `computeSnapshotFinancials`. */
export function planFromQuote(snapshot: FinancialsSource | null | undefined): PlanFigures | null {
  const resolved = resolveSnapshot(snapshot)
  if (!resolved) return null
  const { data, pricing, margin } = resolved
  const totals = computeQuoteTotals(data, margin, pricing)
  const { sections, totalCost } = resolveProfitSections(data, pricing, computeTotalCrewDays(data))
  const summary = computeProfitSummary(data.profitTransferAmount ?? totals.sumaNetto, data.profitTaxRatePercent, totalCost)
  return {
    source: 'quote',
    revenue: summary.sumaNetto,
    taxRatePercent: summary.taxRatePercent,
    tax: summary.podatek,
    costs: summary.koszty,
    profit: summary.zysk,
    marginPct: summary.marzaPct,
    byCategory: byCategory(sections.flatMap((s) => s.lines)),
  }
}

/** Plan z zapisanego wyniku (retro-import bez wyceny). Stawka ryczałtu odtworzona z kwot. */
export function planFromFinancials(financials: ProjectFinancials): PlanFigures {
  const revenue = safeNum(financials.sumaNetto, 0)
  const tax = safeNum(financials.podatek, 0)
  return {
    source: 'import',
    revenue,
    taxRatePercent: revenue > 0 ? (tax / revenue) * 100 : DEFAULT_TAX_RATE,
    tax,
    costs: safeNum(financials.koszty, 0),
    profit: safeNum(financials.zysk, 0),
    marginPct: safeNum(financials.marzaPct, 0),
    byCategory: null,
  }
}

const NO_PLAN: PlanFigures = {
  source: 'none',
  revenue: 0,
  taxRatePercent: DEFAULT_TAX_RATE,
  tax: 0,
  costs: 0,
  profit: 0,
  marginPct: 0,
  byCategory: null,
}

/**
 * Plan projektu. `live` = bieżący stan kalkulatora (ten projekt jest w nim
 * wgrany): projekt z wyceną albo z wyceną właśnie budowaną liczy plan z
 * kalkulatora, więc edycja planu widać od razu. Projekt bez wyceny i z pustym
 * kalkulatorem ma za plan zaimportowany wynik.
 */
export function projectPlan(
  project: Pick<Project, 'quote' | 'financials'>,
  live: { data: Partial<QuoteData>; pricingConfig?: unknown; marginMultiplier?: number } | null
): PlanFigures {
  if (live && (project.quote || !isBlankQuoteData(live.data))) {
    return planFromQuote(live) ?? NO_PLAN
  }
  if (project.quote) return planFromQuote(project.quote as FinancialsSource) ?? NO_PLAN
  if (project.financials) return planFromFinancials(project.financials)
  return NO_PLAN
}

/** Czy plan w kalkulatorze różni się od zapisanego w projekcie (trzeba kliknąć „Zapisz"). */
export function isPlanUnsaved(
  project: Pick<Project, 'quote'>,
  live: { data: Partial<QuoteData>; pricingConfig?: unknown; marginMultiplier?: number }
): boolean {
  if (!project.quote) return !isBlankQuoteData(live.data)
  const saved = planFromQuote(project.quote as FinancialsSource)
  const current = planFromQuote(live)
  if (!saved || !current) return false
  const same = (a: number, b: number) => Math.abs(a - b) < 0.005
  return !(
    same(saved.revenue, current.revenue) &&
    same(saved.costs, current.costs) &&
    same(saved.tax, current.tax)
  )
}

// ── Rzeczywistość ────────────────────────────────────────────────────────────

/** Wynik przy kosztach rzeczywistych: ten sam przychód i ryczałt co w planie. */
export function actualFigures(plan: PlanFigures, costs: ProjectCost[] | null | undefined): ActualFigures {
  const total = totalActualCosts(costs)
  const profit = plan.revenue - plan.tax - total
  return {
    revenue: plan.revenue,
    tax: plan.tax,
    costs: total,
    profit,
    marginPct: plan.revenue > 0 ? (profit / plan.revenue) * 100 : 0,
    costCount: (costs ?? []).filter((c) => !c.deletedAt).length,
    byCategory: actualCostsByCategory(costs),
  }
}

export interface CategoryRow {
  category: string
  /** `null` = plan bez podziału na kategorie (import). */
  plan: number | null
  actual: number
}

/** Plan i rzeczywistość w kategoriach — wiersze, w których cokolwiek jest. */
export function compareByCategory(plan: PlanFigures, actual: ActualFigures): CategoryRow[] {
  const categories = new Set([...(plan.byCategory?.keys() ?? []), ...actual.byCategory.keys()])
  return [...categories].sort(compareCategories).map((category) => ({
    category,
    plan: plan.byCategory ? (plan.byCategory.get(category) ?? 0) : null,
    actual: actual.byCategory.get(category) ?? 0,
  }))
}

// ── Ekipa z planu ────────────────────────────────────────────────────────────

export interface PlannedCrewMember {
  /** Indeks dnia zdjęciowego w wycenie; `null` = każdy dzień (szybka wycena). */
  quoteDay: number | null
  role: string
  unitCost: number
}

const CREW_LINE = /^pro:(.+):(rezOp|asystent|gafer|dzwiekowiec|mua|aktor|model|statysta)$/

/**
 * Ekipa z planu (Profit): osoby, które kosztują — pozycja odznaczona jako
 * „nie mój koszt" (robię sam) nie trafia do ekipy. Szczegółowa wycena: role ×
 * liczba osób w każdym dniu wyceny; szybka: wielkość ekipy na każdy dzień.
 */
export function plannedCrew(snapshot: FinancialsSource | null | undefined): PlannedCrewMember[] {
  const resolved = resolveSnapshot(snapshot)
  if (!resolved) return []
  const { data, pricing } = resolved
  const { sections } = resolveProfitSections(data, pricing, computeTotalCrewDays(data))
  const lines = sections.flatMap((s) => s.lines).filter((line) => line.isCost && !line.isCustom)

  if (!data.isDetailedProdukcja) {
    const line = lines.find((l) => l.key === 'pro:quick:ekipa')
    if (!line) return []
    const crew = Math.max(1, Math.round(safeNum(data.wielkoscEkipy, 1, 1)))
    return Array.from({ length: crew }, () => ({ quoteDay: null, role: 'Operator', unitCost: line.unitCost }))
  }

  const dayIndex = new Map(safeArray<{ id: string }>(data.detailedShootingDays).map((d, i) => [d.id, i]))
  return lines.flatMap((line) => {
    const match = line.key.match(CREW_LINE)
    const index = match ? dayIndex.get(match[1]) : undefined
    if (index === undefined) return []
    const count = Math.max(0, Math.round(line.quantity))
    return Array.from({ length: count }, () => ({ quoteDay: index, role: line.label, unitCost: line.unitCost }))
  })
}

export interface CrewFromPlanResult {
  costs: ProjectCost[]
  added: number
  /** Dni wyceny z ekipą, dla których nie ma dnia zdjęciowego w Realizacji. */
  missingDays: number
  /** Dni zdjęciowe pominięte, bo mają już wpisaną ekipę. */
  keptDays: number
}

/**
 * „Przepisz ekipę z planu": dzień N wyceny → N-ty dzień zdjęciowy Realizacji
 * (chronologicznie). Dzień, który ma już ekipę, zostaje nietknięty — nic się
 * nie dubluje. Osoba zostaje pusta (wycena zna role, nie nazwiska).
 */
export function crewCostsFromPlan(
  plan: PlannedCrewMember[],
  days: { id: string; kind: string }[],
  costs: ProjectCost[],
  now: Date = new Date()
): CrewFromPlanResult {
  const shootDays = days.filter((day) => day.kind === 'shoot_day')
  const hasCrew = (dayId: string) => costsOfDay(costs, dayId).some(isCrew)
  const added: ProjectCost[] = []
  const kept = new Set<string>()
  const missing = new Set<number>()

  const assign = (day: { id: string }, member: PlannedCrewMember) => {
    if (hasCrew(day.id)) {
      kept.add(day.id)
      return
    }
    added.push(
      makeCost(
        { category: 'ekipa', person: '', role: member.role, quantity: 1, unitCost: member.unitCost, dayId: day.id, source: 'plan' },
        now
      )
    )
  }

  plan.forEach((member) => {
    if (member.quoteDay === null) {
      shootDays.forEach((day) => assign(day, member))
      return
    }
    const day = shootDays[member.quoteDay]
    if (day) assign(day, member)
    else missing.add(member.quoteDay)
  })

  return { costs: [...costs, ...added], added: added.length, missingDays: missing.size, keptDays: kept.size }
}

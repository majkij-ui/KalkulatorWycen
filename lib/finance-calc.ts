/**
 * Agregacje finansowe firmy — czyste funkcje, zero zależności od UI i zapisu.
 *
 * Wzorzec jak w `profit-calc.ts`: wszystko liczone deterministycznie z danych
 * wejściowych, żeby dało się to pokryć testami (`node --test lib/*.test.ts`).
 *
 * Poziomy liczb:
 *   projekt  → `ProjectFinancials` (zysk PO podatku i kosztach produkcji)
 *   firma    → zysk projektów MINUS koszty stałe okresu (ZUS, marketing, inne)
 */

import { moneyOf, type MoneyById } from './client-money'
import { fixedCostCategory, type CostCategory } from './fixed-cost-categories'
import type { FixedCost, FixedCostType, Project } from './project-types'
import { countsTowardRevenue, isLiveFixedCost, toMonthKey, toQuarter, toYear } from './project-types'

// ── Okresy ───────────────────────────────────────────────────────────────────

export type PeriodKind = 'year' | 'half' | 'quarter' | 'month'

export interface Period {
  kind: PeriodKind
  year: number
  /** kwartał 1–4 (kind='quarter'), półrocze 1–2 (kind='half'), miesiąc 1–12 (kind='month') */
  index?: number
}

export function periodLabel(period: Period): string {
  const { kind, year, index } = period
  if (kind === 'year') return String(year)
  if (kind === 'half') return `H${index ?? 1} ${year}`
  if (kind === 'quarter') return `Q${index ?? 1} ${year}`
  return `${String(index ?? 1).padStart(2, '0')}.${year}`
}

/** Czy data `YYYY-MM-DD` (lub `YYYY-MM`) wpada w okres. */
export function isInPeriod(dateKey: string, period: Period): boolean {
  const year = toYear(dateKey)
  if (year === null || year !== period.year) return false
  if (period.kind === 'year') return true

  const monthMatch = dateKey.match(/^\d{4}-(\d{2})/)
  if (!monthMatch) return false
  const month = Number(monthMatch[1])
  if (month < 1 || month > 12) return false

  if (period.kind === 'month') return month === period.index
  if (period.kind === 'quarter') return toQuarter(dateKey) === period.index
  // half: 1 → miesiące 1–6, 2 → 7–12
  return (month <= 6 ? 1 : 2) === period.index
}

/** Wszystkie okresy danego typu, w których cokolwiek się wydarzyło — malejąco. */
export function availablePeriods(
  projects: Project[],
  fixedCosts: FixedCost[],
  kind: PeriodKind
): Period[] {
  const seen = new Set<string>()
  const out: Period[] = []

  const add = (dateKey: string) => {
    const year = toYear(dateKey)
    if (year === null) return
    let index: number | undefined
    if (kind !== 'year') {
      const m = dateKey.match(/^\d{4}-(\d{2})/)
      if (!m) return
      const month = Number(m[1])
      if (month < 1 || month > 12) return
      index = kind === 'month' ? month : kind === 'quarter' ? Math.floor((month - 1) / 3) + 1 : month <= 6 ? 1 : 2
    }
    const key = `${year}-${index ?? 0}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ kind, year, index })
  }

  projects.forEach((p) => add(p.date))
  fixedCosts.forEach((c) => add(c.month))

  return out.sort((a, b) => (b.year - a.year) || ((b.index ?? 0) - (a.index ?? 0)))
}

// ── Wynik okresu ─────────────────────────────────────────────────────────────

export interface FixedCostBreakdown {
  zus: number
  marketing: number
  other: number
  total: number
  /** Po kategoriach (`fixed-cost-categories.ts`): oprogramowanie, bank, biuro… */
  byCategory: Partial<Record<CostCategory, number>>
  /** Z subskrypcji: raty wyliczone i ręczne poprawki rat. */
  subscriptions: number
  /** W tym raty wyliczone automatycznie (nie ma ich w pliku). */
  derived: number
}

export interface PeriodSummary {
  period: Period
  label: string
  /** Projekty wliczone do wyniku (status won/done). */
  projectCount: number
  /** Wyceny w okresie — nie wliczane do liczb, pokazywane jako pipeline. */
  quoteCount: number
  /** Suma netto zrealizowanych projektów. */
  revenue: number
  /** Koszty produkcji z zakładki Profit. */
  productionCosts: number
  /** Podatek (ryczałt) z zakładki Profit. */
  tax: number
  /** Zysk projektów po podatku i kosztach produkcji. */
  projectProfit: number
  fixedCosts: FixedCostBreakdown
  /** Wynik firmy: zysk projektów minus koszty stałe okresu. */
  netResult: number
  /** Marża wyniku firmy względem przychodu (0 gdy brak przychodu). */
  marginPct: number
  /** Wartość netto wycen w pipeline (status quote). */
  pipelineValue: number
}

function emptyFixedCosts(): FixedCostBreakdown {
  return { zus: 0, marketing: 0, other: 0, total: 0, byCategory: {}, subscriptions: 0, derived: 0 }
}

/** Dolicza pozycję do worków. Usunięte (`deletedAt`) pomija. */
function addFixedCost(out: FixedCostBreakdown, cost: FixedCost): void {
  if (!isLiveFixedCost(cost)) return
  const amount = Number.isFinite(cost.amount) ? cost.amount : 0
  out[cost.type as FixedCostType] += amount
  out.total += amount
  const category = fixedCostCategory(cost)
  out.byCategory[category] = (out.byCategory[category] ?? 0) + amount
  if (cost.subscriptionId) out.subscriptions += amount
  if (cost.derived) out.derived += amount
}

/**
 * Koszty stałe okresu. Raty subskrypcji wchodzą tylko wtedy, gdy są w `costs`
 * — Finanse podają tu `fixedCostsInYear` (`subscriptions.ts`), nie surowy plik.
 */
export function summarizeFixedCosts(costs: FixedCost[], period: Period): FixedCostBreakdown {
  const out = emptyFixedCosts()
  costs.forEach((cost) => {
    if (isInPeriod(cost.month, period)) addFixedCost(out, cost)
  })
  return out
}

export function summarizePeriod(
  projects: Project[],
  fixedCosts: FixedCost[],
  period: Period,
  /** U1: wartość wycen z pętli pieniędzy (plan + dosprzedaż); brak = plan z `financials`. */
  money?: MoneyById | null
): PeriodSummary {
  const inPeriod = projects.filter((p) => isInPeriod(p.date, period))
  const realized = inPeriod.filter((p) => countsTowardRevenue(p.status))
  const quotes = inPeriod.filter((p) => p.status === 'quote')

  let revenue = 0
  let productionCosts = 0
  let tax = 0
  let projectProfit = 0

  realized.forEach((p) => {
    const f = p.financials
    if (!f) return
    revenue += f.sumaNetto
    productionCosts += f.koszty
    tax += f.podatek
    projectProfit += f.zysk
  })

  const pipelineValue = quotes.reduce((sum, p) => sum + (moneyOf(p, money).revenue ?? 0), 0)
  const fixed = summarizeFixedCosts(fixedCosts, period)
  const netResult = projectProfit - fixed.total

  return {
    period,
    label: periodLabel(period),
    projectCount: realized.length,
    quoteCount: quotes.length,
    revenue,
    productionCosts,
    tax,
    projectProfit,
    fixedCosts: fixed,
    netResult,
    marginPct: revenue > 0 ? (netResult / revenue) * 100 : 0,
    pipelineValue,
  }
}

/** Szereg miesięczny w obrębie roku — pod wykres trendu (recharts). */
export function monthlyTrend(
  projects: Project[],
  fixedCosts: FixedCost[],
  year: number
): PeriodSummary[] {
  return Array.from({ length: 12 }, (_, i) =>
    summarizePeriod(projects, fixedCosts, { kind: 'month', year, index: i + 1 })
  )
}

/** Cztery kwartały roku — pod widok kwartalny. */
export function quarterlyTrend(
  projects: Project[],
  fixedCosts: FixedCost[],
  year: number
): PeriodSummary[] {
  return Array.from({ length: 4 }, (_, i) =>
    summarizePeriod(projects, fixedCosts, { kind: 'quarter', year, index: i + 1 })
  )
}

/**
 * Suma kosztów stałych per miesiąc — do formularza „ZUS za każdy miesiąc".
 * Klucz = `YYYY-MM`.
 */
export function fixedCostsByMonth(costs: FixedCost[]): Map<string, FixedCostBreakdown> {
  const map = new Map<string, FixedCostBreakdown>()
  costs.forEach((cost) => {
    const key = toMonthKey(cost.month)
    if (!key || !isLiveFixedCost(cost)) return
    const bucket = map.get(key) ?? emptyFixedCosts()
    addFixedCost(bucket, cost)
    map.set(key, bucket)
  })
  return map
}

/** Miesiące (`YYYY-MM`) wchodzące w okres — rosnąco. Pod edycję kosztów stałych. */
export function periodMonths(period: Period): string[] {
  const { kind, year, index = 1 } = period
  let first = 1
  let count = 12
  if (kind === 'half') {
    first = index === 2 ? 7 : 1
    count = 6
  } else if (kind === 'quarter') {
    first = (Math.min(4, Math.max(1, index)) - 1) * 3 + 1
    count = 3
  } else if (kind === 'month') {
    first = index
    count = 1
  }
  return Array.from({ length: count }, (_, i) => `${year}-${String(first + i).padStart(2, '0')}`)
}

/** Okres zawierający podaną datę — domyślny wybór na dashboardzie. */
export function periodContaining(date: Date, kind: PeriodKind): Period {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  if (kind === 'year') return { kind, year }
  if (kind === 'half') return { kind, year, index: month <= 6 ? 1 : 2 }
  if (kind === 'quarter') return { kind, year, index: Math.floor((month - 1) / 3) + 1 }
  return { kind, year, index: month }
}

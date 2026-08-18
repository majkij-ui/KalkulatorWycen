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

import type { FixedCost, FixedCostType, Project } from './project-types'
import { countsTowardRevenue, toMonthKey, toQuarter, toYear } from './project-types'

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
  return { zus: 0, marketing: 0, other: 0, total: 0 }
}

export function summarizeFixedCosts(costs: FixedCost[], period: Period): FixedCostBreakdown {
  const out = emptyFixedCosts()
  costs.forEach((cost) => {
    if (!isInPeriod(cost.month, period)) return
    const amount = Number.isFinite(cost.amount) ? cost.amount : 0
    out[cost.type as FixedCostType] += amount
    out.total += amount
  })
  return out
}

export function summarizePeriod(
  projects: Project[],
  fixedCosts: FixedCost[],
  period: Period
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

  const pipelineValue = quotes.reduce((sum, p) => sum + (p.financials?.sumaNetto ?? 0), 0)
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
    if (!key) return
    const bucket = map.get(key) ?? emptyFixedCosts()
    const amount = Number.isFinite(cost.amount) ? cost.amount : 0
    bucket[cost.type as FixedCostType] += amount
    bucket.total += amount
    map.set(key, bucket)
  })
  return map
}

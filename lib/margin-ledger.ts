/**
 * Rejestr marży (S4, plan §3.1, decyzje A i B z 2026-10-13) — JEDNO miejsce,
 * z którego ekrany pieniędzy (Finanse, Klienci, raport S5) biorą warstwy.
 *
 * Fakty na wejściu, nic nie jest zapisywane:
 *  - pieniądze projektów z pętli (`moneyLedger`, T6): przychód wg najlepszej
 *    wiedzy (faktury / plan + dodatki), koszty z Realizacji albo z planu;
 *  - koszty stałe okresu z ratami subskrypcji (`fixedCostsInYear`, S1);
 *  - zakupy sprzętu z katalogu, na plan i zaplecze (`gear-costs.ts`);
 *  - marketing = koszty stałe w kategorii marketing (kampanie).
 *
 * Warstwy:
 *  1. MARŻA NA REALIZACJI = przychód − koszty bezpośrednie (Realizacja albo
 *     plan). Przed podatkiem. Per projekt w każdym okresie.
 *  2. WYNIK PO KOSZTACH FIRMY = warstwa 1 − ryczałt − ZUS − subskrypcje i inne
 *     koszty stałe − sprzęt − marketing. Dla okresu zawsze; PER PROJEKT tylko
 *     w widoku roku (decyzja A): koszty firmy bez podatku dzielimy na projekty
 *     wg udziału w przychodzie roku, podatek każdy projekt ma swój. Suma
 *     wierszy = wynik roku.
 *  - MARŻA PRODUCENCKA (R2) = warstwa 1 − ryczałt − wartość mojej pracy, per
 *    projekt (po podatku, jak w zakładce Finanse projektu); dla firmy to suma
 *    wierszy. Wynikiem firmy zostaje warstwa 2.
 *  - EBBT (U1, plan §17.2, „earnings before bad things") = warstwa 1 − ryczałt
 *    − ZUS: bez wszystkiego, co M.J. mógłby w teorii pominąć (sprzęt,
 *    subskrypcje i inne koszty stałe, marketing). Ten sam w obu widokach
 *    sprzętu. EBBT − wynik firmy = pole do optymalizacji. Z filtrem klienta —
 *    tylko w widoku roku (udział w ZUS wg udziału w przychodzie, jak warstwa 2).
 *  - Przełącznik „Rozłóż duże zakupy sprzętu" zmienia sprzęt, więc każdą
 *    liczbę warstwy 2 (także per projekt).
 *  - Okres, który się jeszcze nie skończył, jest „wstępnie": koszty firmy do
 *    końca okresu z planu (raty subskrypcji, rozłożony sprzęt), projekty w
 *    realizacji z planu.
 *  - Filtr klienta / grupy (S2) zawęża projekty i ich sumy; udziały liczymy
 *    zawsze ze wszystkich projektów, więc grupa niesie swoją część kosztów firmy.
 *
 * Moduł czysty — testy w `margin-ledger.test.ts`.
 */

import { inClientScope } from './client-groups'
import type { CostCategory } from './fixed-cost-categories'
import { fixedCostCategory } from './fixed-cost-categories'
import { isInPeriod, periodMonths, summarizeFixedCosts, type Period } from './finance-calc'
import { countedAmount, gearCostInPeriod, type GearPeriodCost, type GearSpreadSettings } from './gear-costs'
import { summarizeMoney, type MoneySummary, type ProjectMoney } from './money-loop'
import { isLiveFixedCost, type EquipmentItem, type FixedCost, type Project } from './project-types'
import { DEFAULT_TAX_RATE } from './realization-plan'

/** Ryczałt projektu bez planu: company.json, a bez niego 8,5 %. */
export function companyTaxRate(company?: { defaultTaxRatePercent?: unknown } | null): number {
  const rate = company?.defaultTaxRatePercent
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate < 100 ? rate : DEFAULT_TAX_RATE
}

export interface CompanyCosts {
  /** Ryczałt od przychodu okresu (każdy projekt swoją stawką). */
  tax: number
  zus: number
  /** Subskrypcje i inne koszty stałe: oprogramowanie, bank, biuro, telefon, ubezpieczenia, inne. */
  fixed: number
  marketing: number
  /** Sprzęt: katalog (rozłożony albo w całości) + ręczne „Sprzęt spoza katalogu". */
  gear: number
  /** Wszystko bez podatku — to dzielimy na projekty w widoku roku. */
  overhead: number
  total: number
}

export interface ProjectMargin {
  money: ProjectMoney
  /** Kotwica w okresie: tu leżą koszty projektu. */
  anchored: boolean
  /** Przychód w okresie (kawałki z datą w okresie). */
  revenue: number
  /** Koszty bezpośrednie w okresie (projekt zakotwiczony; nieznane = 0). */
  costs: number
  /** Warstwa 1 w okresie. */
  margin: number
  /** Czy przychód jest znany; `false` = „brak kwoty", warstwa 1 to tylko koszty. */
  known: boolean
  tax: number
  /** R2: wartość mojej pracy w okresie (projekt zakotwiczony, jak koszty). */
  ownWork: number
  /**
   * R2 (V1): marża producencka w okresie = warstwa 1 − moja praca, PRZED
   * podatkiem (V1 zastąpiło decyzję „po podatku" z 2026-10-18). Suma wierszy =
   * marża producencka firmy.
   */
  producerMargin: number
  /** Udział w przychodzie roku (0–1); `null` poza widokiem roku. */
  share: number | null
  /** U1: EBBT projektu = warstwa 1 − podatek − udział w ZUS; `null` poza widokiem roku. */
  ebbt: number | null
  /** Przypisane koszty firmy bez podatku; `null` poza widokiem roku. */
  overhead: number | null
  /** Warstwa 2 projektu; `null` poza widokiem roku. */
  result: number | null
}

export interface MarginTotals {
  projects: number
  revenue: number
  costs: number
  margin: number
  tax: number
  /** R2: moja praca w projektach okresu. */
  ownWork: number
  /** R2 (V1): suma marż producenckich projektów (przed podatkiem). */
  producerMargin: number
  /** Koszty firmy bez podatku przypisane projektom; `null` poza rokiem (dla zawężenia). */
  overhead: number | null
  /** Warstwa 2; dla całej firmy zawsze, dla zawężenia tylko w roku. */
  result: number | null
  /** U1: EBBT = warstwa 1 − ryczałt − ZUS; dla całej firmy zawsze, dla zawężenia tylko w roku. */
  ebbt: number | null
}

export interface MarginSummary {
  period: Period
  spread: boolean
  /** Widok roku: warstwa 2 per projekt. */
  perProject: boolean
  /** Okres jeszcze trwa (albo jest przyszły) — „wstępnie". */
  provisional: boolean
  /** Podstawa z pętli pieniędzy (wpłaty, pokrycie fakturami, plan). */
  money: MoneySummary
  /** Projekty okresu w zakresie filtra, wg kotwicy. */
  projects: ProjectMargin[]
  company: CompanyCosts
  gear: GearPeriodCost
  /** Cała firma. */
  totals: MarginTotals
  /** Zawężenie do klienta / grupy; `null` = bez filtra. */
  scoped: MarginTotals | null
  /** Koszty firmy bez podatku, których nie ma na kogo podzielić (rok bez przychodu). */
  unallocated: number
}

export interface MarginInput {
  ledger: ProjectMoney[]
  /** Koszty stałe roku: ręczne + raty subskrypcji (`fixedCostsInYear`). */
  fixedCosts: FixedCost[]
  /** Cały katalog (`allItems`), na plan i zaplecze. */
  equipment: EquipmentItem[]
  spread: boolean
  settings: GearSpreadSettings
  today: string
  /** Id projektów w filtrze klienta; `null` / brak = wszystkie. */
  scope?: ReadonlySet<string> | null
}

/** Id projektów klienta albo grupy (`scopeKeys`); `null` = bez filtra. */
export function projectIdsInScope(
  projects: Pick<Project, 'id' | 'client'>[],
  keys: Set<string> | null
): Set<string> | null {
  if (!keys) return null
  return new Set(projects.filter((p) => inClientScope(p, keys)).map((p) => p.id))
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/** Koszty firmy okresu; ręczne pozycje powiązane z katalogiem liczą tylko resztę. */
function companyCosts(input: MarginInput, period: Period, tax: number, gear: GearPeriodCost): CompanyCosts {
  const fixed = summarizeFixedCosts(input.fixedCosts, period)
  // Pozycja powiązana z katalogiem (np. „Sprzęt" z zakupem z katalogu) poza
  // kategorią sprzętu: odejmujemy powiązane z jej worka. Sprzęt robi to sam.
  const linked: Partial<Record<CostCategory, number>> = {}
  input.fixedCosts.forEach((cost) => {
    if (!isLiveFixedCost(cost) || !cost.catalogueItemIds?.length || !isInPeriod(cost.month, period)) return
    const category = fixedCostCategory(cost)
    if (category === 'gear') return
    const amount = Number.isFinite(cost.amount) ? cost.amount : 0
    linked[category] = (linked[category] ?? 0) + amount - countedAmount(cost, input.equipment)
  })
  const bucket = (category: CostCategory) => (fixed.byCategory[category] ?? 0) - (linked[category] ?? 0)
  const zus = bucket('zus')
  const marketing = bucket('marketing')
  const linkedOther = sum(
    Object.entries(linked)
      .filter(([category]) => category !== 'zus' && category !== 'marketing')
      .map(([, value]) => value ?? 0)
  )
  const other = fixed.total - (fixed.byCategory.zus ?? 0) - (fixed.byCategory.marketing ?? 0) - (fixed.byCategory.gear ?? 0) - linkedOther
  const overhead = zus + other + marketing + gear.total
  return { tax, zus, fixed: other, marketing, gear: gear.total, overhead, total: overhead + tax }
}

function totalsOf(rows: ProjectMargin[], perProject: boolean): MarginTotals {
  return {
    projects: rows.length,
    revenue: sum(rows.map((r) => r.revenue)),
    costs: sum(rows.map((r) => r.costs)),
    margin: sum(rows.map((r) => r.margin)),
    tax: sum(rows.map((r) => r.tax)),
    ownWork: sum(rows.map((r) => r.ownWork)),
    producerMargin: sum(rows.map((r) => r.producerMargin)),
    overhead: perProject ? sum(rows.map((r) => r.overhead ?? 0)) : null,
    result: perProject ? sum(rows.map((r) => r.result ?? 0)) : null,
    ebbt: perProject ? sum(rows.map((r) => r.ebbt ?? 0)) : null,
  }
}

export function marginSummary(input: MarginInput, period: Period): MarginSummary {
  const money = summarizeMoney(input.ledger, input.fixedCosts, period)
  const gear = gearCostInPeriod(input.equipment, input.fixedCosts, period, input.spread, input.settings)
  const company = companyCosts(input, period, money.tax, gear)
  const perProject = period.kind === 'year'
  const months = periodMonths(period)
  const provisional = months[months.length - 1] >= input.today.slice(0, 7)

  const all: ProjectMargin[] = money.projects.map((row) => {
    const costs = row.anchored ? (row.money.costs ?? 0) : 0
    const ownWork = row.anchored ? row.money.ownWork : 0
    const tax = row.revenue * (row.money.taxRatePercent / 100)
    return {
      money: row.money,
      anchored: row.anchored,
      revenue: row.revenue,
      costs,
      margin: row.revenue - costs,
      known: row.money.revenue !== null,
      tax,
      ownWork,
      producerMargin: row.revenue - costs - ownWork,
      share: null,
      ebbt: null,
      overhead: null,
      result: null,
    }
  })

  // Decyzja A: udział w przychodzie = udział w kosztach firmy (bez podatku).
  const revenueTotal = sum(all.map((r) => Math.max(0, r.revenue)))
  let unallocated = company.overhead
  if (perProject && revenueTotal > 0) {
    unallocated = 0
    all.forEach((r) => {
      r.share = Math.max(0, r.revenue) / revenueTotal
      r.overhead = r.share * company.overhead
      r.result = r.margin - r.tax - r.overhead
      r.ebbt = r.margin - r.tax - r.share * company.zus
    })
  } else if (perProject) {
    all.forEach((r) => {
      r.share = 0
      r.overhead = 0
      r.result = r.margin - r.tax
      r.ebbt = r.margin - r.tax
    })
  }

  const totalsAll = totalsOf(all, perProject)
  const totals: MarginTotals = {
    ...totalsAll,
    overhead: company.overhead,
    result: totalsAll.margin - company.total,
    ebbt: totalsAll.margin - company.tax - company.zus,
  }
  const scope = input.scope ?? null
  const projects = (scope ? all.filter((r) => scope.has(r.money.id)) : all).sort((a, b) =>
    a.money.anchor.localeCompare(b.money.anchor)
  )

  return {
    period,
    spread: input.spread,
    perProject,
    provisional,
    money,
    projects,
    company,
    gear,
    totals,
    scoped: scope ? totalsOf(projects, perProject) : null,
    unallocated,
  }
}

export interface MarginTrendRow {
  month: number
  /** Warstwa 1 (w zakresie filtra). */
  margin: number
  /** Koszty firmy z podatkiem (cała firma). */
  companyCosts: number
  /** Warstwa 2 całej firmy. */
  result: number
}

/** Dwanaście miesięcy roku — pod wykres. */
export function marginTrend(input: MarginInput, year: number): MarginTrendRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const s = marginSummary(input, { kind: 'month', year, index: i + 1 })
    return {
      month: i + 1,
      margin: (s.scoped ?? s.totals).margin,
      companyCosts: s.company.total,
      result: s.totals.result ?? 0,
    }
  })
}

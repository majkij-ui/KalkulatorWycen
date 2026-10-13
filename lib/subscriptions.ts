/**
 * Raty subskrypcji liczone przy odczycie (S1, decyzja C z 2026-10-13).
 *
 * Reguły:
 *  - Subskrypcja to fakt. Jej raty wpadają AUTOMATYCZNIE: pierwsza w dniu
 *    `startDate`, kolejne co 1 / 12 / N miesięcy tego samego dnia (31. w
 *    lutym = ostatni dzień lutego), dopóki dzień raty ≤ `endDate`. Nic z tego
 *    nie jest zapisywane, więc poprawiona ręcznie cena czy data zmienia od razu
 *    wszystkie miesiące.
 *  - Kwota w złotych = kwota × kurs subskrypcji (PLN: × 1), w groszach.
 *    Waluta bez kursu, nieznany cykl albo brak daty startu → raty się nie
 *    liczą, a subskrypcja mówi dlaczego (`subscriptionProblem`) — nigdy 0 zł
 *    udające fakt.
 *  - POPRAWKA miesiąca = zwykła pozycja kosztów stałych z `subscriptionId` i
 *    `month` (kwota zapłacona, inny kurs, 0 zł = miesiąc pominięty). Zastępuje
 *    ratę wyliczoną; kilka poprawek tego samego miesiąca to kilka faktów i
 *    sumują się. Usunięcie poprawki przywraca ratę automatyczną. Miesiąc nigdy
 *    nie liczy się dwa razy.
 *  - Poprawka poza miesiącem raty (dopłata, rata przed startem) liczy się jako
 *    sama siebie. Usunięta subskrypcja nie ma rat, a jej poprawki zostają —
 *    to były prawdziwe płatności.
 *
 * Finanse liczą koszty stałe zawsze przez `effectiveFixedCosts` /
 * `fixedCostsInYear`. Moduł czysty — testy w `subscriptions.test.ts`.
 */

import {
  categoryFields,
  fixedCostCategory,
  isCostCategory,
  withCategory,
  type CostCategory,
} from './fixed-cost-categories'
import { createFixedCostId, isLiveFixedCost, type FixedCost } from './project-types'
import { isSubscriptionCadence, type Subscription } from './subscription-types'

const MONTH_KEY = /^(\d{4})-(\d{2})$/
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

// ── Miesiące ─────────────────────────────────────────────────────────────────

/** `YYYY-MM` → numer miesiąca od roku 0; `null` dla złego klucza. */
function monthIndex(month: string): number | null {
  const m = MONTH_KEY.exec(month)
  if (!m) return null
  const index = Number(m[2])
  if (index < 1 || index > 12) return null
  return Number(m[1]) * 12 + index - 1
}

function monthFromIndex(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

function daysInMonth(index: number): number {
  return new Date(Date.UTC(Math.floor(index / 12), (index % 12) + 1, 0)).getUTCDate()
}

/** `YYYY-MM` przesunięty o `count` miesięcy. */
export function addMonths(month: string, count: number): string {
  const index = monthIndex(month)
  return index === null ? month : monthFromIndex(index + count)
}

// ── Jedna subskrypcja ────────────────────────────────────────────────────────

/** Co ile miesięcy rata; `null` = nieznany cykl albo „co N" bez N. */
export function intervalMonths(sub: Pick<Subscription, 'cadence' | 'everyMonths'>): number | null {
  if (!isSubscriptionCadence(sub.cadence)) return null
  if (sub.cadence === 'monthly') return 1
  if (sub.cadence === 'yearly') return 12
  return sub.everyMonths && Number.isInteger(sub.everyMonths) && sub.everyMonths >= 1 ? sub.everyMonths : null
}

/** Złotych za jednostkę waluty; `null` = waluta obca bez kursu. */
export function plnRate(sub: Pick<Subscription, 'currency' | 'rate'>): number | null {
  if (sub.currency === 'PLN') return 1
  return typeof sub.rate === 'number' && Number.isFinite(sub.rate) && sub.rate > 0 ? sub.rate : null
}

const toGrosze = (value: number) => Math.round(value * 100) / 100

/** Jedna rata w złotych; `null`, gdy nie da się jej policzyć. */
export function chargePln(sub: Pick<Subscription, 'amount' | 'currency' | 'rate'>): number | null {
  const rate = plnRate(sub)
  if (rate === null || !Number.isFinite(sub.amount)) return null
  return toGrosze(sub.amount * rate)
}

export type SubscriptionProblem = 'start' | 'cadence' | 'rate'

/** Dlaczego raty się NIE liczą: brak daty startu, nieznany cykl, brak kursu. */
export function subscriptionProblem(sub: Subscription): SubscriptionProblem | null {
  if (!DATE_KEY.test(sub.startDate)) return 'start'
  if (intervalMonths(sub) === null) return 'cadence'
  if (chargePln(sub) === null) return 'rate'
  return null
}

export interface SubscriptionCharge {
  subscriptionId: string
  /** `YYYY-MM` */
  month: string
  /** Dzień raty `YYYY-MM-DD`. */
  day: string
  /** W złotych. */
  amount: number
  /** W walucie subskrypcji. */
  originalAmount: number
  currency: string
  rate: number
}

/** Raty wyliczone w miesiącach `from`..`to` (`YYYY-MM`, włącznie). */
export function subscriptionCharges(sub: Subscription, from: string, to: string): SubscriptionCharge[] {
  if (sub.deletedAt || subscriptionProblem(sub)) return []
  const fromIndex = monthIndex(from)
  const toIndex = monthIndex(to)
  const start = DATE_KEY.exec(sub.startDate)!
  const startIndex = monthIndex(`${start[1]}-${start[2]}`)
  if (fromIndex === null || toIndex === null || startIndex === null || fromIndex > toIndex) return []

  const step = intervalMonths(sub)!
  const amount = chargePln(sub)!
  const rate = plnRate(sub)!
  const startDay = Number(start[3])
  const out: SubscriptionCharge[] = []
  const first = startIndex + Math.max(0, Math.ceil((fromIndex - startIndex) / step)) * step
  for (let index = first; index <= toIndex; index += step) {
    const month = monthFromIndex(index)
    const day = `${month}-${String(Math.min(startDay, daysInMonth(index))).padStart(2, '0')}`
    if (sub.endDate && day > sub.endDate) break
    out.push({
      subscriptionId: sub.id,
      month,
      day,
      amount,
      originalAmount: sub.amount,
      currency: sub.currency,
      rate,
    })
  }
  return out
}

/** Rata za jeden miesiąc (`null` = w tym miesiącu nie ma raty). */
export function chargeInMonth(sub: Subscription, month: string): SubscriptionCharge | null {
  return subscriptionCharges(sub, month, month)[0] ?? null
}

/** Średnio na miesiąc w złotych (rata roczna / 12); `null` = nie da się policzyć. */
export function monthlyValue(sub: Subscription): number | null {
  const amount = chargePln(sub)
  const step = intervalMonths(sub)
  return amount === null || step === null ? null : amount / step
}

/** Na rok w złotych (rata × raty w roku). */
export function yearlyValue(sub: Subscription): number | null {
  const monthly = monthlyValue(sub)
  return monthly === null ? null : monthly * 12
}

export type SubscriptionStatus = 'planned' | 'active' | 'ended'

/** Zakończona (koniec przed dziś), zaplanowana (start po dziś) albo trwa. */
export function subscriptionStatus(sub: Subscription, today: string): SubscriptionStatus {
  if (sub.endDate && sub.endDate < today) return 'ended'
  if (DATE_KEY.test(sub.startDate) && sub.startDate > today) return 'planned'
  return 'active'
}

export function subscriptionCategory(sub: Pick<Subscription, 'category'>): CostCategory {
  return isCostCategory(sub.category) ? sub.category : 'other'
}

// ── Koszty stałe z ratami ────────────────────────────────────────────────────

/** Rata wyliczona z subskrypcji (nie ma jej w pliku). */
export interface DerivedInfo {
  day: string
  originalAmount: number
  currency: string
  rate: number
}

export type EffectiveFixedCost = FixedCost & {
  /** Jest tylko dla rat wyliczonych; ręczne pozycje go nie mają. */
  derived?: DerivedInfo
}

export function isDerivedCost(cost: EffectiveFixedCost): boolean {
  return Boolean(cost.derived)
}

const overrideKey = (subscriptionId: string, month: string) => `${subscriptionId}|${month}`

/** Pozycja kosztów z raty — kształt jak ręczna, plus `derived`. */
function derivedCost(sub: Subscription, charge: SubscriptionCharge): EffectiveFixedCost {
  return {
    id: `auto-${sub.id}-${charge.month}`,
    month: charge.month,
    ...categoryFields(subscriptionCategory(sub)),
    label: sub.name,
    amount: charge.amount,
    source: 'manual',
    subscriptionId: sub.id,
    derived: {
      day: charge.day,
      originalAmount: charge.originalAmount,
      currency: charge.currency,
      rate: charge.rate,
    },
  }
}

const inRange = (month: string, from: string, to: string) => month >= from && month <= to

/**
 * Koszty stałe miesięcy `from`..`to`: ręczne (nieusunięte) plus raty
 * subskrypcji tam, gdzie nie ma ręcznej poprawki tej subskrypcji za ten miesiąc.
 */
export function effectiveFixedCosts(
  costs: FixedCost[],
  subscriptions: Subscription[],
  from: string,
  to: string
): EffectiveFixedCost[] {
  const live = new Map(subscriptions.filter((sub) => !sub.deletedAt).map((sub) => [sub.id, sub]))
  const manual = costs
    .filter((c) => isLiveFixedCost(c) && inRange(c.month, from, to))
    .map((c) => {
      // Poprawka liczy się w kategorii swojej subskrypcji — zmiana kategorii
      // subskrypcji nie zostawia starych miesięcy w starym worku.
      const sub = c.subscriptionId ? live.get(c.subscriptionId) : undefined
      return sub ? withCategory(c, subscriptionCategory(sub)) : c
    })
  const corrected = new Set(manual.flatMap((c) => (c.subscriptionId ? [overrideKey(c.subscriptionId, c.month)] : [])))
  const derived = [...live.values()].flatMap((sub) =>
    subscriptionCharges(sub, from, to)
      .filter((charge) => !corrected.has(overrideKey(sub.id, charge.month)))
      .map((charge) => derivedCost(sub, charge))
  )
  return [...manual, ...derived]
}

/** Koszty stałe roku (styczeń–grudzień) — wejście dla `summarizeMoney` i `moneyTrend`. */
export function fixedCostsInYear(costs: FixedCost[], subscriptions: Subscription[], year: number): EffectiveFixedCost[] {
  return effectiveFixedCosts(costs, subscriptions, `${year}-01`, `${year}-12`)
}

/** „Co jeśli": te same koszty bez rat i poprawek wskazanych subskrypcji. */
export function withoutSubscriptions<T extends FixedCost>(costs: T[], excluded: ReadonlySet<string>): T[] {
  if (excluded.size === 0) return costs
  return costs.filter((c) => !c.subscriptionId || !excluded.has(c.subscriptionId))
}

/** Suma kosztów każdej subskrypcji (raty i poprawki) w podanych kosztach. */
export function totalsBySubscription(costs: FixedCost[]): Map<string, number> {
  const totals = new Map<string, number>()
  costs.forEach((c) => {
    if (!c.subscriptionId || !isLiveFixedCost(c)) return
    totals.set(c.subscriptionId, (totals.get(c.subscriptionId) ?? 0) + (Number.isFinite(c.amount) ? c.amount : 0))
  })
  return totals
}

/**
 * Ręczna poprawka raty za `month` (kwota w złotych; 0 = miesiąc pominięty).
 * Kategoria i opis z subskrypcji.
 */
export function subscriptionCorrection(sub: Subscription, month: string, amount: number): FixedCost {
  return {
    id: createFixedCostId(),
    month,
    ...categoryFields(subscriptionCategory(sub)),
    label: sub.name,
    amount,
    source: 'manual',
    subscriptionId: sub.id,
  }
}

/**
 * Nowa cena „od teraz": raty z miesięcy PRZED `currentMonth`, które nie mają
 * poprawki, zapisane jako poprawki po starej cenie. Po zapisie zmienionej
 * subskrypcji tylko bieżący i dalsze miesiące liczą się po nowemu. Bez tego
 * zmiana ceny poprawia wszystkie miesiące (pomyłka we wpisie).
 */
export function pastChargesToKeep(sub: Subscription, costs: FixedCost[], currentMonth: string): FixedCost[] {
  const corrected = new Set(
    costs.filter((c) => isLiveFixedCost(c) && c.subscriptionId === sub.id).map((c) => c.month)
  )
  return subscriptionCharges(sub, sub.startDate.slice(0, 7), addMonths(currentMonth, -1))
    .filter((charge) => !corrected.has(charge.month))
    .map((charge) => subscriptionCorrection(sub, charge.month, charge.amount))
}

/**
 * Czy zmiana to nowa cena (kwota w złotych albo cykl) — wtedy formularz pyta
 * „od teraz czy wszystkie miesiące". Zmiana daty startu to poprawka startu,
 * nazwa czy notatka nie ruszają rat.
 */
export function changesPrice(before: Subscription, after: Subscription): boolean {
  return chargePln(before) !== chargePln(after) || intervalMonths(before) !== intervalMonths(after)
}

/**
 * Ręczne pozycje (bez `subscriptionId`), które mogą być tą samą opłatą co
 * subskrypcja w miesiącach jej rat: ta sama kategoria albo nazwa subskrypcji
 * w opisie. Formularz ostrzega, zanim miesiąc policzy się dwa razy.
 */
export function possibleDoubles(sub: Subscription, costs: FixedCost[]): FixedCost[] {
  const manual = costs.filter((c) => isLiveFixedCost(c) && !c.subscriptionId)
  if (manual.length === 0) return []
  const last = manual.reduce((max, c) => (c.month > max ? c.month : max), '')
  const months = new Set(subscriptionCharges(sub, sub.startDate.slice(0, 7), last).map((c) => c.month))
  const category = subscriptionCategory(sub)
  const name = sub.name.trim().toLocaleLowerCase('pl')
  return manual.filter((c) => {
    if (!months.has(c.month)) return false
    if (category !== 'other' && fixedCostCategory(c) === category) return true
    return name.length >= 3 && c.label.toLocaleLowerCase('pl').includes(name)
  })
}

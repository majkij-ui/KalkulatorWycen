/**
 * Przychód i zysk projektu w okresie dla Klientów (filtr okresu na liście).
 *
 * Te same zasady co „Zysk" projektu w Finansach (`summarizeMoney`): przychód
 * w okresie = kawałki przychodu z datą w okresie; podatek od tego przychodu;
 * koszty × udział kosztów w okresie (`periodCostShare`). „Moja praca" nie jest
 * kosztem, koszty stałe i sprzęt nie są przypisywane klientom.
 *
 * Plik jest liściem (bez importu `money-loop` i `client-stats`), żeby `money-loop`
 * mógł stąd brać `periodCostShare` bez cyklu. Moduł czysty.
 */

import type { ClientMoney } from './client-money'
import { isInPeriod, type Period } from './finance-calc'

const EPSILON = 0.005

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/**
 * Koszty idą za fakturami (decyzja 2026-11-05): gdy przychód projektu jest znany
 * (> 0) i ma kawałki przychodu, okres dostaje koszty × (kawałki w okresie / suma
 * wszystkich kawałków) — to samo dla mojej pracy, a z nią marży producenckiej.
 * Inaczej (brak faktur i planu, przychód nieznany albo 0) całość leży w kotwicy.
 * Udziały jednego projektu dają razem dokładnie 1.
 */
export function periodCostShare(money: Pick<ClientMoney, 'revenue' | 'anchor' | 'pieces'>, period: Period): number {
  const onAnchor = isInPeriod(money.anchor, period) ? 1 : 0
  if (money.revenue === null || money.revenue <= EPSILON) return onAnchor
  const total = sum(money.pieces.map((piece) => piece.amount))
  if (total <= EPSILON) return onAnchor
  const here = sum(money.pieces.filter((piece) => isInPeriod(piece.day, period)).map((piece) => piece.amount))
  return Math.min(1, Math.max(0, here / total))
}

/** Czy projekt ma w okresie choć jeden kawałek przychodu (też ujemną korektę). `null` = zawsze, gdy ma przychód. */
export function hasRevenueInPeriod(money: ClientMoney, period: Period | null): boolean {
  if (period === null) return true
  return money.pieces.some((piece) => isInPeriod(piece.day, period))
}

/** Przychód projektu w okresie (suma kawałków z datą w okresie); `null` = cały. Nieznany = 0. */
export function revenueInPeriod(money: ClientMoney, period: Period | null): number {
  if (period === null) return money.revenue ?? 0
  return sum(money.pieces.filter((piece) => isInPeriod(piece.day, period)).map((piece) => piece.amount))
}

/**
 * Zysk projektu w okresie: przychód − podatek od niego − koszty × udział
 * w okresie. `null` = cały (udział 1). Nieznany przychód daje 0.
 */
export function profitInPeriod(money: ClientMoney, period: Period | null): number {
  if (money.revenue === null) return 0
  const revenue = revenueInPeriod(money, period)
  const share = period === null ? 1 : periodCostShare(money, period)
  return revenue - revenue * (money.taxRatePercent / 100) - (money.costs ?? 0) * share
}

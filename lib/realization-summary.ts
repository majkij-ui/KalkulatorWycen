/**
 * Suma Realizacji i bilans wyceny (U2, U-SUMA; decyzja M.J. 2026-10-24,
 * §18.3/3) — czyste funkcje.
 *
 *   Realizacja razem = wszystkie zaznaczone wiersze, koszty zewnętrzne i moja
 *                      praca osobno (wszystkie kategorie, dni i grupy)
 *   bilans           = cena − (koszty zewnętrzne + moja praca + sprzęt zarobił),
 *                      przed podatkiem; + = wycenione na moją korzyść,
 *                      − = na moją niekorzyść. „Koordynacja i produkcja" jest
 *                      częścią PDF, więc liczy się na moją korzyść.
 *
 * Nigdy nie wychodzi na zero: moja praca wyceniona tak, jak uważam, pokazuje,
 * czy źle wyceniłem. Druga linia porównuje to samo z kwotą z Finansów
 * (z dosprzedażą / przelewem / fakturami), bo koszty dosprzedaży już są w
 * Realizacji.
 */

import { approvedPrice, resolveSnapshot, type ApprovedPrice, type FinancialsSource } from './quote-financials'
import { costAmount, isOwnWork, liveCosts } from './project-costs'
import type { ProjectCost } from './project-types'

/**
 * Cena, z którą porównuje bilans — JEDNO miejsce do podmiany. Dziś: suma PDF
 * wybranego wariantu, a bez szkicu PDF — kalkulator (R2, `approvedPrice`).
 * Przy scalaniu z U1 (zatwierdzona cena w wycenie: wpisany przelew →
 * zatwierdzona cena → PDF → kalkulator) wystarczy zmienić tę funkcję.
 */
export function quotedPrice(snapshot: FinancialsSource | null | undefined): ApprovedPrice | null {
  const resolved = resolveSnapshot(snapshot)
  if (!resolved) return null
  return approvedPrice(resolved.data, resolved.pricing, resolved.margin, snapshot?.pdfDraft)
}

export interface RealizationTotals {
  /** Zaznaczone koszty zewnętrzne. */
  external: number
  /** Zaznaczona moja praca. */
  own: number
  total: number
}

/** Suma całej Realizacji: wszystkie żywe, zaznaczone wiersze. */
export function realizationTotals(costs: ProjectCost[] | null | undefined): RealizationTotals {
  let external = 0
  let own = 0
  liveCosts(costs).forEach((cost) => {
    if (cost.skipped) return
    if (isOwnWork(cost)) own += costAmount(cost)
    else external += costAmount(cost)
  })
  return { external, own, total: external + own }
}

export interface Reconciliation {
  price: number
  external: number
  own: number
  gearEarned: number
  /** cena − (zewnętrzne + moja praca + sprzęt). */
  balance: number
}

export function reconcile(
  price: number,
  totals: Pick<RealizationTotals, 'external' | 'own'>,
  gearEarned: number | null
): Reconciliation {
  const gear = gearEarned ?? 0
  return {
    price,
    external: totals.external,
    own: totals.own,
    gearEarned: gear,
    balance: price - (totals.external + totals.own + gear),
  }
}

/** Kwota wpisana po polsku, także ujemna („−100", „-1 200,50"); `null` = puste albo nieczytelne. */
export function parseSignedAmount(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(/[−–]/g, '-').replace(',', '.').replace(/zł$/i, '')
  if (!normalized || normalized === '-') return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Druga linia bilansu tylko wtedy, gdy kwota z Finansów różni się od ceny (o ≥ 0,50 zł). */
export function differsFromPrice(price: number, other: number | null | undefined): other is number {
  return typeof other === 'number' && Number.isFinite(other) && Math.abs(other - price) >= 0.5
}
